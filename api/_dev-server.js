import http from 'node:http';
import { URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadEnvFile(fileName) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [key, ...valueParts] = line.split('=');
    if (key && !process.env[key]) {
      process.env[key] = valueParts.join('=').trim();
    }
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const port = Number(process.env.API_PORT || 3000);
const routes = {
  '/api/ai-status': () => import('./ai-status.js'),
  '/api/ai-tutor-chat': () => import('./ai-tutor-chat.js'),
  '/api/ask-forge-assistant': () => import('./ask-forge-assistant.js'),
  '/api/generate-forge-structure': () => import('./generate-forge-structure.js'),
  '/api/process-uploaded-notes': () => import('./process-uploaded-notes.js'),
  '/api/extract-timetable-docs': () => import('./extract-timetable-docs.js'),
  '/api/generate-learning-content': () => import('./generate-learning-content.js'),
  '/api/generate-question-hint': () => import('./generate-question-hint.js'),
  '/api/explain-wrong-answer': () => import('./explain-wrong-answer.js'),
  '/api/generate-timetable': () => import('./generate-timetable.js'),
  '/api/generate-daily-challenge': () => import('./generate-daily-challenge.js'),
  '/api/delete-cloudinary-files': () => import('./delete-cloudinary-files.js'),
};

function createResponse(res) {
  const responseState = {
    statusCode: 200,
    headers: {},
  };

  const response = {
    setHeader(name, value) {
      responseState.headers[name] = value;
      res.setHeader(name, value);
      return response;
    },
    status(code) {
      responseState.statusCode = code;
      return response;
    },
    json(payload) {
      res.writeHead(responseState.statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        ...responseState.headers,
      });
      res.end(JSON.stringify(payload));
    },
    end(body = '') {
      res.writeHead(responseState.statusCode, responseState.headers);
      res.end(body);
    },
  };

  return response;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve(undefined);
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const routeHandler = routes[requestUrl.pathname];
  if (!routeHandler) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const body = await readBody(req);
    const module = await routeHandler();
    const handler = module.default;
    const request = {
      body,
      headers: req.headers || {},
      method: req.method,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      url: requestUrl.pathname,
    };

    await handler(request, createResponse(res));
  } catch (error) {
    console.error('Local API error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error', message: error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local API server listening on http://127.0.0.1:${port}`);
});
