import { useEffect, useRef, useState, useCallback } from "react";

export const DEFAULT_STAGES = [
  "Uploading file(s)",
  "Processing document",
  "Extracting subjects/topics",
  "Generating timetable",
  "Saving to Firestore",
  "Finalizing",
];

// Maps progress % to stage index
function progressToStage(progress, stages) {
  if (progress < 20) return 0;
  if (progress < 35) return 1;
  if (progress < 55) return 2;
  if (progress < 75) return 3;
  if (progress < 90) return 4;
  return Math.min(5, stages.length - 1);
}

/**
 * useStagedProgress
 * - Quickly reaches ~20% after start
 * - Slowly creeps toward 85-90% while busy
 * - Only reaches 100% when done() is called or busy becomes false after minDuration
 * - Ensures overlay visible for at least minDuration ms
 *
 * Usage:
 *   const { progress, stage, visible, start, finish, setStage } = useStagedProgress({ minDuration: 1000 });
 *   // or controlled mode:
 *   const { progress, stage } = useStagedProgress({ busy, minDuration: 1000 });
 */
export function useStagedProgress(options = {}) {
  const {
    busy = undefined, // if defined, hook controls itself via busy boolean
    stages = DEFAULT_STAGES,
    minDuration = 1000,
    creepInterval = 220,
  } = options;

  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const startTimeRef = useRef(0);
  const creepTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const isBusyRef = useRef(false);

  const clearCreep = useCallback(() => {
    if (creepTimerRef.current) {
      clearInterval(creepTimerRef.current);
      creepTimerRef.current = null;
    }
  }, []);

  const clearHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearHide();
    clearCreep();
    isBusyRef.current = true;
    startTimeRef.current = Date.now();
    setVisible(true);
    setProgress(2);
    setStageIndex(0);

    // Quickly reach ~20% after upload starts (~300ms)
    const quickTimer = setTimeout(() => {
      if (!isBusyRef.current) return;
      setProgress(20);
      setStageIndex(progressToStage(20, stages));
    }, 320);
    // Store for cleanup via creepTimerRef placeholder
    // Start creeping toward 85-90% after quick phase
    const creepStart = setTimeout(() => {
      if (!isBusyRef.current) return;
      creepTimerRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 88) return prev;
          // Slow, diminishing increments
          const remaining = 88 - prev;
          const inc = Math.max(0.6, remaining * 0.06 + Math.random() * 1.2);
          const next = Math.min(88, prev + inc);
          return Math.round(next * 10) / 10;
        });
      }, creepInterval);
    }, 500);

    return () => {
      clearTimeout(quickTimer);
      clearTimeout(creepStart);
    };
  }, [clearCreep, clearHide, creepInterval, stages]);

  const finish = useCallback(() => {
    isBusyRef.current = false;
    clearCreep();
    const elapsed = Date.now() - startTimeRef.current;
    const remainingMin = Math.max(0, minDuration - elapsed);

    // Immediately move to 90% (Saving to Firestore)
    setProgress((prev) => Math.max(prev, 90));
    setStageIndex(stages.length - 2);

    // After remainingMin, animate to 100% then hide
    hideTimerRef.current = setTimeout(() => {
      setProgress(100);
      setStageIndex(stages.length - 1);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        // reset after hide animation
        setTimeout(() => {
          setProgress(0);
          setStageIndex(0);
        }, 300);
      }, 420);
    }, remainingMin + 180);
  }, [clearCreep, minDuration, stages.length]);

  // Sync stage index from progress
  useEffect(() => {
    setStageIndex(progressToStage(progress, stages));
  }, [progress, stages]);

  // Controlled mode via busy prop
  useEffect(() => {
    if (busy === undefined) return;
    if (busy && !visible) {
      start();
    } else if (busy && visible && !isBusyRef.current) {
      // re-start if busy became true again after finish
      start();
    } else if (!busy && isBusyRef.current) {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCreep();
      clearHide();
    };
  }, [clearCreep, clearHide]);

  // Allow manual stage override (e.g., tie to real events)
  const setStage = useCallback(
    (indexOrName) => {
      let idx = 0;
      if (typeof indexOrName === "number") idx = indexOrName;
      else if (typeof indexOrName === "string") {
        const found = stages.findIndex((s) => s.toLowerCase() === indexOrName.toLowerCase());
        idx = found >= 0 ? found : 0;
      }
      setStageIndex(idx);
      // Also bump progress to at least the stage's lower bound
      const bounds = [0, 20, 35, 55, 75, 90];
      const target = bounds[idx] || 0;
      setProgress((prev) => (prev < target ? target : prev));
    },
    [stages]
  );

  // Allow manual progress bump but cap simulation to 88 unless finishing
  const setProgressCapped = useCallback((value) => {
    if (isBusyRef.current && value > 88 && value < 100) {
      setProgress(Math.min(88, value));
    } else {
      setProgress(Math.min(100, Math.max(0, value)));
    }
  }, []);

  const stage = stages[stageIndex] || stages[0];

  return {
    progress,
    stage,
    stageIndex,
    visible,
    start,
    finish,
    setStage,
    setProgress: setProgressCapped,
    _rawSetProgress: setProgress,
  };
}

export default useStagedProgress;
