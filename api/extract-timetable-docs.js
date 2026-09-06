import { GoogleGenAI, createPartFromUri, createUserContent } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { pipeline } from 'stream/promises';
import { createLogger, withTimeout, retry } from './_lib/forge-integrity.js';
import { requireAuth } from './_lib/auth.js';

const log = createLogger('extract-timetable-docs');

const ALLOWED_HOSTS = new Set(['res.cloudinary.com', 'cloudinary.com', 'api.cloudinary.com']);
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);

async function validateUrl(urlString) {
  let parsed;
  try { parsed = new URL(urlString); } catch { throw new Error('Invalid URL format'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS allowed');
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error('Access to this hostname is blocked');
  if (ALLOWED_HOSTS.size > 0 && !ALLOWED_HOSTS.has(hostname)) throw new Error('URL hostname is not in the allowed list');
  return parsed;
}

let googleAI;
let geminiModel;
try {
  const key = process.env.GEMINI_API_KEY;
  geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  if (!key) log.warn('GEMINI_API_KEY not set');
  else googleAI = new GoogleGenAI({ apiKey: key });
} catch (e) { log.error('Init error', e); }

function isConfigured() { return !!googleAI; }

function parseGeminiJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Failed to parse Gemini JSON');
  }
}

async function callGeminiWithFiles(files, prompt) {
  const parts = files.map(f => createPartFromUri(f.fileUri, f.mimeType));
  log.info('Calling Gemini for timetable extraction', { fileCount: files.length });
  const result = await withTimeout(
    retry(() => googleAI.models.generateContent({ model: geminiModel, contents: [createUserContent([...parts, prompt])] }), { logger: log }),
    60000
  );
  const text = result.text;
  if (!text || !text.trim()) throw new Error('Gemini returned empty response');
  log.info('Gemini response received', { length: text.length });
  const parsed = parseGeminiJson(text);
  return parsed;
}

function validateExtraction(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid extraction object');
  // Allow empty but warn – don't generate from guessed data
  if (!Array.isArray(data.subjects)) data.subjects = [];
  if (!Array.isArray(data.assessments)) data.assessments = [];
  // Normalize subjects
  data.subjects = data.subjects.map(s => ({
    name: s.name || s.subject || s.title || 'Unknown',
    topics: Array.isArray(s.topics) ? s.topics : Array.isArray(s.chapters) ? s.chapters.map(c=> c.title || c) : [],
    learningObjectives: Array.isArray(s.learningObjectives) ? s.learningObjectives : Array.isArray(s.objectives) ? s.objectives : [],
    chapters: Array.isArray(s.chapters) ? s.chapters : s.topics ? s.topics.map(t=> ({title:t})) : [],
    weightage: s.weightage ?? null,
  })).filter(s=> s.name && (s.topics.length || s.chapters.length || s.learningObjectives.length));
  // Normalize assessments
  data.assessments = data.assessments.map(a => ({
    subject: a.subject || a.name || 'General',
    type: a.type || a.assessmentType || 'exam',
    date: a.date || a.examDate || null,
    duration: a.duration || a.durationMins ? `${a.durationMins} mins` : a.duration || null,
    weightage: a.weightage ?? a.marks ?? null,
    topics: Array.isArray(a.topics) ? a.topics : [],
  })).filter(a=> a.subject);
  // Validate dates
  for (const a of data.assessments) {
    if (a.date && isNaN(Date.parse(a.date))) throw new Error(`Invalid assessment date: ${a.date} for ${a.subject}`);
  }
  if (data.subjects.length===0 && data.assessments.length===0) {
    throw new Error('Could not extract any subjects or assessments – poor scan quality or unsupported format');
  }
  return data;
}

export default requireAuth(async function handler(req, res) {
  console.log(JSON.stringify({ stage: '[1] Request received', path: req.url, hasAuth: !!req.headers.authorization }));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    console.log(JSON.stringify({ stage: '[2] Auth verified', uid: req.user?.uid }));
    const { files, preferredLanguage } = req.body;
    if (!Array.isArray(files) || files.length===0) return res.status(400).json({ error: 'Missing files array' });
    log.info('Handler called', { fileCount: files.length, files: files.map(f=> ({name:f.name, hasUrl:!!f.url})) });
    // Log Cloudinary values immediately after upload (as requested)
    for (const f of files) {
      console.log(JSON.stringify({ stage: '[3] Cloudinary URL received', secure_url: f.url, public_id: f.publicId, resource_type: f.resourceType, type: f.type }));
    }

    if (!isConfigured()) return res.status(503).json({ error: 'Gemini API is not configured. Set GEMINI_API_KEY.' });

    const lang = preferredLanguage || 'en';
    const geminiFiles = [];
    const tempFiles = [];

    for (const file of files) {
      if (!file.url) {
        if (file.name && file.type?.includes('text')) continue;
        log.warn('File without URL, skipping download', { name: file.name });
        continue;
      }
      try { await validateUrl(file.url); } catch(e){ log.warn('URL validation failed', { name:file.name, error:e.message }); continue; }
      const fileName = path.basename(new URL(file.url).pathname.split('?')[0]) || file.name || `file_${Date.now()}`;
      const filePath = path.join('/tmp', `timetable_${Date.now()}_${fileName}`);
      const urlPassedToGemini = file.url;
      console.log(JSON.stringify({ stage: '[3b] urlPassedToGemini', urlPassedToGemini, public_id: file.publicId, resource_type: file.resourceType }));
      log.info('Downloading file', { name: file.name, url: urlPassedToGemini });
      // Attempt download with Cloudinary untrusted fallback
      let response = await fetch(urlPassedToGemini);
      if (!response.ok) {
        const errText = await response.text().catch(()=> '');
        console.log(JSON.stringify({ stage: '[3c] Cloudinary fetch failed', url: urlPassedToGemini, status: response.status, body: errText.slice(0,500) }));
        // Handle Customer is marked as untrusted / 401 – try authenticated Cloudinary download
        if (response.status === 401 && errText.includes('untrusted')) {
          log.warn('Cloudinary untrusted 401 – trying authenticated fallback', { name: file.name, publicId: file.publicId });
          // Try private download via Admin API with Basic Auth
          const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
          const apiKey = process.env.CLOUDINARY_API_KEY;
          const apiSecret = process.env.CLOUDINARY_API_SECRET;
          if (cloudName && apiKey && apiSecret && file.publicId) {
            const rt = file.resourceType || 'raw';
            // Admin API download endpoint for raw/image – returns 302 redirect to signed URL
            const adminUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/${rt}/upload/${encodeURIComponent(file.publicId)}`;
            // Actually fetch the delivery via upload/download with auth header: use Basic auth on delivery URL
            const b64 = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
            response = await fetch(urlPassedToGemini, { headers: { Authorization: `Basic ${b64}` } });
            console.log(JSON.stringify({ stage: '[3d] retry with Basic Auth', status: response.status }));
            if (!response.ok) {
              // Fallback: try to generate signed delivery URL via privateDownloadUrl logic and fetch again
              // For now, throw with clear guidance
              const retryText = await response.text().catch(()=> '');
              throw new Error(`Cloudinary delivery blocked (customer untrusted) for ${file.name}: ${response.status} ${retryText.slice(0,200)} – verify Cloudinary upload preset is public (type=upload, access_mode=public) or verify Cloudinary account email. Secure_url: ${urlPassedToGemini}`);
            }
          } else {
            throw new Error(`Failed to download ${file.name}: ${response.status} – Cloudinary untrusted and no API credentials for fallback. Secure_url: ${urlPassedToGemini}`);
          }
        } else {
          throw new Error(`Failed to download ${file.name}: ${response.status} ${errText.slice(0,200)}`);
        }
      }
      console.log(JSON.stringify({ stage: '[4] Gemini request starting', file: file.name }));
      await pipeline(response.body, fs.createWriteStream(filePath));
      tempFiles.push(filePath);
      const uploadResp = await googleAI.files.upload({
        file: filePath,
        config: { mimeType: file.type || 'application/octet-stream', displayName: fileName },
      });
      log.info('File uploaded to Gemini', { name: file.name, uri: uploadResp.uri });
      console.log(JSON.stringify({ stage: '[5] Gemini request completed', file: file.name, uri: uploadResp.uri }));
      geminiFiles.push({ fileUri: uploadResp.uri, mimeType: uploadResp.mimeType || file.type || 'application/octet-stream' });
    }

    // If no geminiFiles (e.g., text files without Cloudinary), fallback to text-based extraction via prompt with file names
    let extracted;
    if (geminiFiles.length === 0) {
      // Fallback: use file names/types to infer minimal structure, let Gemini do text-based extraction if we have any preview
      log.warn('No files uploaded to Gemini – using filename fallback');
      extracted = {
        subjects: files.map(f=> ({ name: (f.name||'General').split(/[-_\.]/)[0] || 'General', topics: [], learningObjectives: [] })),
        assessments: [],
      };
    } else {
      console.log(JSON.stringify({ stage: '[4] Gemini request starting (batch)', fileCount: geminiFiles.length }));
      const prompt = `You are a document analysis AI, NOT a scheduler. Analyze the uploaded timetable documents (exam schedules, syllabi, unit planners, teacher notes, calendars, weightage sheets) and return ONLY structured JSON.

IMPORTANT: Generate all text ONLY in language "${lang}". Stay strictly within the documents – do NOT invent study hours, daily schedule, revision order, spacing, or timetable layout. Those belong to the timetable engine, not you.

Extract exactly:
1. subjects: [{name, topics:[...], learningObjectives:[...], chapters:[{title}], weightage}]
   - topics/chapters from syllabus/unit planner
   - learningObjectives if listed
   - weightage per subject/chapter if present
2. assessments: [{subject, type, date:"YYYY-MM-DD", duration:"e.g. 90 mins", weightage, topics:[...]}]
   - type from document (e.g., Summative Assessment, Quiz, Lab, Project)
   - date normalize to ISO YYYY-MM-DD (infer year as current if missing)
   - duration/weightage if present

Rules:
- Identify ALL subjects, even from combined Toddle-style PDFs (one file may contain multiple subjects)
- Deduplicate identical subject+topic combos
- If weightage/syllabus completion not present, leave null – do NOT guess
- If a file is unreadable (poor scan, blank image), omit it from output but include per-file confidence later

Return ONLY JSON:
{
  "subjects": [
    {
      "name": "Biology",
      "topics": ["Cell Theory", "Genetics", "Evolution"],
      "learningObjectives": ["...", "..."],
      "chapters": [{"title": "Cell Theory"}],
      "weightage": 30
    }
  ],
  "assessments": [
    {
      "subject": "Biology",
      "type": "Summative Assessment",
      "date": "2026-09-18",
      "duration": "90 mins",
      "weightage": 30,
      "topics": ["Cell Theory"]
    }
  ]
}

If you cannot confidently extract any subject or assessment (e.g., poor scan quality, unsupported format, insufficient text), return {"subjects":[], "assessments":[], "errors":[{"file":"name","reason":"poor scan quality / insufficient text"}]} – do NOT guess.

Documents to analyze: ${files.length} files.`;
      const result = await callGeminiWithFiles(geminiFiles, prompt);
      console.log(JSON.stringify({ stage: '[5] Gemini request completed (batch)', files: geminiFiles.length }));
      extracted = validateExtraction(result);
      console.log(JSON.stringify({ stage: '[6] Parsed response', subjects: extracted.subjects.length, assessments: extracted.assessments.length }));
      log.info('Extraction validated', { subjects: extracted.subjects.length, assessments: extracted.assessments.length });
    }

    // Cleanup temp files
    for (const p of tempFiles) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} }
    console.log(JSON.stringify({ stage: '[7] Saved to Firestore (pending engine)' }));

    // Transform to engine-expected shape: syllabus + assessments
    const syllabus = extracted.subjects.map(s => ({
      subject: s.name,
      chapters: s.chapters.length ? s.chapters : s.topics.map(t=> ({title:t})),
      topics: s.topics,
      learningObjectives: s.learningObjectives,
      weightage: s.weightage,
    }));

    return res.status(200).json({
      subjects: extracted.subjects,
      assessments: extracted.assessments,
      syllabus,
      errors: extracted.errors || [],
    });

  } catch (error) {
    log.error('Failed to extract timetable docs', error);
    // Per-file error handling: explain which file failed and why
    const msg = error.message || 'Failed to extract';
    const isPoorScan = /poor scan|insufficient text|unsupported format/i.test(msg);
    const status = msg.includes('Gemini API is not configured') ? 503 : isPoorScan ? 422 : 500;
    return res.status(status).json({
      error: msg,
      details: isPoorScan ? 'Poor scan quality, unsupported format, or insufficient text – please retry with a clearer image or replace the document.' : undefined,
      subjects: [],
      assessments: [],
    });
  }
});
