"use client";

import { CircleStop } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type AssistantState = "ready" | "listening" | "thinking" | "speaking" | "ended" | "error";

type RecognitionEvent = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type RecognitionErrorEvent = { error: string };

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor() {
  const browserWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
}

export default function VoiceAgent({ autoStart = true }: { autoStart?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [active, setActive] = useState(false);
  const [assistantState, setAssistantState] = useState<AssistantState>("ready");
  const [audioUrl, setAudioUrl] = useState("");
  const activeRef = useRef(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const listenRef = useRef<() => void>(() => undefined);
  const restartTimerRef = useRef<number | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef("");

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const scheduleListening = useCallback((delay = 400) => {
    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (activeRef.current) listenRef.current();
    }, delay);
  }, [clearRestartTimer]);

  const stopResources = useCallback(() => {
    activeRef.current = false;
    clearRestartTimer();
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;

    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
  }, [clearRestartTimer]);

  useEffect(() => stopResources, [stopResources]);

  const askQuestion = useCallback(async (nextQuestion: string) => {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion || !activeRef.current) return;

    clearRestartTimer();
    audioRef.current?.pause();
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;

    setAssistantState("thinking");

    try {
      const answerResponse = await fetch("/api/voice-agent/answer", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
        signal: requestController.signal,
      });
      const answerPayload = (await answerResponse.json().catch(() => null)) as
        | { topic?: string; answer?: string; error?: string }
        | null;
      if (!answerResponse.ok || !answerPayload?.answer || !answerPayload.topic) {
        throw new Error(answerPayload?.error || "EgoPrism could not answer that question.");
      }
      if (!activeRef.current) return;

      setAnswer(answerPayload.answer);
      const speechResponse = await fetch(
        `/api/voice-agent/speak?topic=${encodeURIComponent(answerPayload.topic)}`,
        {
          cache: "force-cache",
          headers: { Accept: "audio/mpeg" },
          signal: requestController.signal,
        },
      );
      if (!speechResponse.ok) {
        const errorPayload = (await speechResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorPayload?.error || "The spoken answer is unavailable right now.");
      }
      if (!activeRef.current) return;

      const nextAudioUrl = URL.createObjectURL(await speechResponse.blob());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = nextAudioUrl;
      setAudioUrl(nextAudioUrl);
      setAssistantState("speaking");

      requestAnimationFrame(() => {
        audioRef.current?.play().catch(() => {
          if (!activeRef.current) return;
          setAssistantState("ready");
          scheduleListening(500);
        });
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setAssistantState("error");
      if (activeRef.current) scheduleListening(1_500);
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
    }
  }, [clearRestartTimer, scheduleListening]);

  const beginListening = useCallback(() => {
    clearRestartTimer();
    if (!activeRef.current) return;

    const BrowserRecognition = recognitionConstructor();
    if (!BrowserRecognition) {
      setAssistantState("error");
      return;
    }

    audioRef.current?.pause();
    const previousRecognition = recognitionRef.current;
    if (previousRecognition) {
      previousRecognition.onstart = null;
      previousRecognition.onresult = null;
      previousRecognition.onerror = null;
      previousRecognition.onend = null;
      previousRecognition.stop();
    }

    const recognition = new BrowserRecognition();
    let heardQuestion = false;
    let handledError = false;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      setAssistantState("listening");
    };
    recognition.onresult = (event) => {
      const spokenQuestion = event.results[0]?.[0]?.transcript?.trim();
      if (!spokenQuestion) return;
      heardQuestion = true;
      void askQuestion(spokenQuestion);
    };
    recognition.onerror = (event) => {
      handledError = true;
      if (!activeRef.current) return;

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setAssistantState("error");
        return;
      }

      setAssistantState("ready");
      scheduleListening(event.error === "network" ? 1_400 : 650);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (activeRef.current && !heardQuestion && !handledError) scheduleListening();
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setAssistantState("ready");
      scheduleListening(850);
    }
  }, [askQuestion, clearRestartTimer, scheduleListening]);

  useEffect(() => {
    listenRef.current = beginListening;
  }, [beginListening]);

  const startAssistant = useCallback(() => {
    activeRef.current = true;
    setActive(true);
    setAssistantState("ready");
    beginListening();
  }, [beginListening]);

  useEffect(() => {
    if (autoStart) startAssistant();
  }, [autoStart, startAssistant]);

  const endAssistant = () => {
    stopResources();
    setAudioUrl("");
    setActive(false);
    setAssistantState("ended");
  };

  const handleAudioEnded = () => {
    setAssistantState("ready");
    if (activeRef.current) scheduleListening(300);
  };

  const statusLabel = assistantState === "listening"
    ? "Listening"
    : assistantState === "thinking"
      ? "Finding answer"
      : assistantState === "speaking"
        ? "Speaking"
        : assistantState === "ended"
          ? "Conversation ended"
          : assistantState === "error"
            ? "Voice unavailable"
            : active
              ? "Standing by"
              : "Starting";

  return (
    <section className="voice-tooltip-card" data-status={assistantState} aria-label="EgoPrism voice answer">
      <header className="voice-tooltip-card__head">
        <span className="voice-tooltip-status"><i aria-hidden="true" />{statusLabel}</span>
        {active ? (
          <button type="button" onClick={endAssistant}>
            <CircleStop aria-hidden="true" size={15} />
            <span>End conversation</span>
          </button>
        ) : null}
      </header>

      <div className="voice-answer-transcript" aria-live="polite" aria-atomic="true">
        {answer ? <p>{answer}</p> : null}
      </div>

      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          aria-label="ElevenLabs answer audio"
          onPlay={() => setAssistantState("speaking")}
          onEnded={handleAudioEnded}
        />
      ) : null}
    </section>
  );
}
