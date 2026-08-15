"use client";

import {
  AudioLines,
  Bot,
  CircleStop,
  Mic,
  Radio,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type TranscriptItem = {
  id: string;
  role: "user" | "agent";
  text: string;
};

type AssistantState = "ready" | "listening" | "thinking" | "speaking" | "error";

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

const starterQuestions = [
  "Why did Subset B win?",
  "How is the diversity score calculated?",
  "What does this result not prove?",
];

function recognitionConstructor() {
  const browserWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
}

export default function VoiceAgent() {
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [question, setQuestion] = useState("");
  const [active, setActive] = useState(false);
  const [assistantState, setAssistantState] = useState<AssistantState>("ready");
  const [localError, setLocalError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const activeRef = useRef(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const listenRef = useRef<() => void>(() => undefined);
  const restartTimerRef = useRef<number | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const scheduleListening = useCallback((delay = 450) => {
    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (activeRef.current) listenRef.current();
    }, delay);
  }, [clearRestartTimer]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearRestartTimer();
      requestAbortRef.current?.abort();
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      }
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [clearRestartTimer]);

  useEffect(() => {
    const transcriptNode = transcriptRef.current;
    if (transcriptNode) transcriptNode.scrollTop = transcriptNode.scrollHeight;
  }, [transcript.length]);

  const appendTranscript = useCallback((role: TranscriptItem["role"], text: string) => {
    setTranscript((items) => [
      ...items,
      { id: `${Date.now()}-${role}-${items.length}`, role, text },
    ]);
  }, []);

  const askQuestion = useCallback(async (nextQuestion: string) => {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion || !activeRef.current) return;

    clearRestartTimer();
    audioRef.current?.pause();
    requestAbortRef.current?.abort();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;

    setLocalError("");
    setAssistantState("thinking");
    appendTranscript("user", trimmedQuestion);

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

      appendTranscript("agent", answerPayload.answer);
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
          setLocalError("The answer is ready. Press play; listening resumes when it finishes.");
        });
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setAssistantState("error");
      setLocalError(error instanceof Error ? error.message : "The voice answer could not be created.");
      if (activeRef.current) scheduleListening(1_600);
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
    }
  }, [appendTranscript, clearRestartTimer, scheduleListening]);

  const beginListening = useCallback(() => {
    clearRestartTimer();
    if (!activeRef.current) return;

    const BrowserRecognition = recognitionConstructor();
    if (!BrowserRecognition) {
      setAssistantState("error");
      setLocalError("Voice input is unavailable in this browser. Keep the session open and type below.");
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
      setLocalError("");
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
        setLocalError("Microphone permission was denied. The typed conversation stays available below.");
        return;
      }

      setAssistantState("ready");
      setLocalError(
        event.error === "no-speech"
          ? "I did not hear a question, so I am reopening the microphone."
          : "The microphone paused briefly. Listening will resume automatically.",
      );
      scheduleListening(event.error === "network" ? 1_500 : 700);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (activeRef.current && !heardQuestion && !handledError) {
        setAssistantState("ready");
        scheduleListening();
      }
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setAssistantState("ready");
      setLocalError("The microphone paused briefly. Listening will resume automatically.");
      scheduleListening(900);
    }
  }, [askQuestion, clearRestartTimer, scheduleListening]);

  useEffect(() => {
    listenRef.current = beginListening;
  }, [beginListening]);

  const startAssistant = () => {
    activeRef.current = true;
    setActive(true);
    setLocalError("");
    setAssistantState("ready");
    beginListening();
  };

  const endAssistant = () => {
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
    setAudioUrl("");
    setActive(false);
    setAssistantState("ready");
    setLocalError("");
  };

  const handleAudioEnded = () => {
    setAssistantState("ready");
    if (activeRef.current) scheduleListening(350);
  };

  const askTypedQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!activeRef.current || !nextQuestion) return;
    setQuestion("");
    void askQuestion(nextQuestion);
  };

  const statusLabel = assistantState === "listening"
    ? "Listening"
    : assistantState === "thinking"
      ? "Checking evidence"
      : assistantState === "speaking"
        ? "Speaking"
        : assistantState === "error"
          ? "Needs attention"
          : active
            ? "Standing by"
            : "Not started";

  const stageTitle = assistantState === "listening"
    ? "Go ahead — I’m listening"
    : assistantState === "thinking"
      ? "Finding the documented answer"
      : assistantState === "speaking"
        ? "Answering with ElevenLabs"
        : assistantState === "error"
          ? "Voice input needs attention"
          : active
            ? "Ready for your next question"
            : "Start once. Keep talking.";

  const stageDetail = assistantState === "listening"
    ? "Ask one question naturally. I’ll answer, then listen again."
    : assistantState === "thinking"
      ? "The answer is being matched to verified EgoPrism facts."
      : assistantState === "speaking"
        ? "The microphone will reopen automatically when this answer ends."
        : assistantState === "error"
          ? "Retry the microphone or keep the session open and type below."
          : active
            ? "Hands-free mode remains live until you press Stop assistant."
            : "The assistant cycles through listening, answering, and listening again until you stop it.";

  const busy = assistantState === "listening" || assistantState === "thinking";
  const voiceButtonLabel = assistantState === "listening"
    ? "Listening…"
    : assistantState === "thinking"
      ? "Finding answer…"
      : assistantState === "speaking"
        ? "Interrupt and ask"
        : "Retry microphone";

  return (
    <section className="voice-agent-section" id="voice-agent" aria-labelledby="voice-agent-title">
      <div className="voice-agent-intro">
        <div>
          <h2 id="voice-agent-title">A conversation, not a voice button.</h2>
          <p>
            Start once, then speak naturally. EgoPrism answers with ElevenLabs and automatically
            listens again after every response until you stop the session.
          </p>
        </div>
        <div className="voice-agent-trust">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Grounded answers · server-only key · always under your control</span>
        </div>
      </div>

      <div className="voice-agent-console" data-active={active} data-status={assistantState}>
        <div className="voice-agent-console__head">
          <div className="agent-identity">
            <span className="agent-identity__mark"><Bot aria-hidden="true" size={19} /></span>
            <span><strong>EgoPrism voice analyst</strong><small>Continuous voice · verified project facts</small></span>
          </div>
          <span className="agent-status" data-active={active}>
            <i aria-hidden="true" /> {active ? "Session live" : "Session off"}
          </span>
        </div>

        <div className="agent-stage" aria-live="polite">
          <span className="agent-stage__signal" aria-hidden="true">
            {assistantState === "listening" ? <Radio size={24} /> : <AudioLines size={24} />}
            <i /><i /><i />
          </span>
          <div className="agent-stage__copy">
            <span>{statusLabel}</span>
            <strong>{stageTitle}</strong>
            <p>{stageDetail}</p>
          </div>
        </div>

        <div
          className="agent-transcript"
          ref={transcriptRef}
          aria-live="polite"
          aria-label="Voice conversation transcript"
        >
          {transcript.length > 0 ? (
            transcript.slice(-10).map((item) => (
              <div className="agent-message" data-role={item.role} key={item.id}>
                <span>{item.role === "agent" ? "EgoPrism" : "You"}</span>
                <p>{item.text}</p>
              </div>
            ))
          ) : (
            <div className="agent-empty">
              <span>Good first questions</span>
              <ul>
                {starterQuestions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="agent-controls">
          {active ? (
            <>
              <button
                type="button"
                className="button button--secondary button--graphite"
                disabled={busy}
                onClick={beginListening}
              >
                {busy ? <AudioLines className="spinner" aria-hidden="true" size={17} /> : <Mic aria-hidden="true" size={17} />}
                <span>{voiceButtonLabel}</span>
              </button>
              <button type="button" className="button button--danger" onClick={endAssistant}>
                <CircleStop aria-hidden="true" size={17} />
                <span>Stop assistant</span>
              </button>
            </>
          ) : (
            <button type="button" className="button button--primary agent-start" onClick={startAssistant}>
              <Mic aria-hidden="true" size={17} />
              <span>Start continuous conversation</span>
            </button>
          )}
        </div>

        {audioUrl ? (
          <audio
            className="agent-audio"
            ref={audioRef}
            controls
            src={audioUrl}
            aria-label="ElevenLabs answer audio"
            onPlay={() => setAssistantState("speaking")}
            onEnded={handleAudioEnded}
          />
        ) : null}

        <form className="agent-question" onSubmit={askTypedQuestion}>
          <label htmlFor="agent-question-input">Text fallback — the session stays continuous</label>
          <div>
            <input
              id="agent-question-input"
              value={question}
              maxLength={240}
              disabled={!active || busy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={active ? "Ask about the score or evidence…" : "Start the conversation first"}
            />
            <button
              type="submit"
              className="button button--primary"
              disabled={!active || busy || !question.trim()}
              aria-label="Send typed question"
            >
              <Send aria-hidden="true" size={17} />
              <span>Send</span>
            </button>
          </div>
          <p className="agent-question__helper" data-state={localError ? "error" : "idle"}>
            {localError || "Your browser recognizes speech; ElevenLabs generates the spoken answers."}
          </p>
        </form>
      </div>
    </section>
  );
}
