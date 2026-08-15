"use client";

import {
  AudioLines,
  Bot,
  Mic,
  PhoneOff,
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
  const recognitionRef = useRef<Recognition | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const appendTranscript = useCallback((role: TranscriptItem["role"], text: string) => {
    setTranscript((items) => [
      ...items,
      { id: `${Date.now()}-${role}-${items.length}`, role, text },
    ]);
  }, []);

  const askQuestion = useCallback(async (nextQuestion: string) => {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion) return;

    setLocalError("");
    setAssistantState("thinking");
    appendTranscript("user", trimmedQuestion);

    try {
      const answerResponse = await fetch("/api/voice-agent/answer", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      const answerPayload = (await answerResponse.json().catch(() => null)) as
        | { topic?: string; answer?: string; error?: string }
        | null;
      if (!answerResponse.ok || !answerPayload?.answer || !answerPayload.topic) {
        throw new Error(answerPayload?.error || "EgoPrism could not answer that question.");
      }

      appendTranscript("agent", answerPayload.answer);
      const speechResponse = await fetch(
        `/api/voice-agent/speak?topic=${encodeURIComponent(answerPayload.topic)}`,
        { cache: "force-cache", headers: { Accept: "audio/mpeg" } },
      );
      if (!speechResponse.ok) {
        const errorPayload = (await speechResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(errorPayload?.error || "The spoken answer is unavailable right now.");
      }

      const nextAudioUrl = URL.createObjectURL(await speechResponse.blob());
      setAudioUrl((previousAudioUrl) => {
        if (previousAudioUrl) URL.revokeObjectURL(previousAudioUrl);
        return nextAudioUrl;
      });
      setAssistantState("speaking");
      requestAnimationFrame(() => {
        audioRef.current?.play().catch(() => {
          setAssistantState("ready");
          setLocalError("The answer is ready. Press play to hear it.");
        });
      });
    } catch (error) {
      setAssistantState("error");
      setLocalError(error instanceof Error ? error.message : "The voice answer could not be created.");
    }
  }, [appendTranscript]);

  const beginListening = () => {
    setLocalError("");
    const BrowserRecognition = recognitionConstructor();
    if (!BrowserRecognition) {
      setAssistantState("error");
      setLocalError("Voice input is unavailable in this browser. You can still type a question below.");
      return;
    }

    audioRef.current?.pause();
    const recognition = new BrowserRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setAssistantState("listening");
    recognition.onresult = (event) => {
      const spokenQuestion = event.results[0]?.[0]?.transcript?.trim();
      if (spokenQuestion) void askQuestion(spokenQuestion);
    };
    recognition.onerror = (event) => {
      setAssistantState("error");
      setLocalError(
        event.error === "not-allowed"
          ? "Microphone permission was denied. You can still type a question below."
          : "I could not hear that question. Try again or use the text box.",
      );
    };
    recognition.onend = () => {
      setAssistantState((current) => current === "listening" ? "ready" : current);
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setAssistantState("error");
      setLocalError("The microphone could not be started. Try the text box instead.");
    }
  };

  const startAssistant = () => {
    setActive(true);
    beginListening();
  };

  const endAssistant = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    audioRef.current?.pause();
    setActive(false);
    setAssistantState("ready");
    setLocalError("");
  };

  const askTypedQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!active || !nextQuestion) return;
    setQuestion("");
    void askQuestion(nextQuestion);
  };

  const statusLabel = assistantState === "listening"
    ? "Listening to your question"
    : assistantState === "thinking"
      ? "Finding the documented answer"
      : assistantState === "speaking"
        ? "Speaking with ElevenLabs"
        : assistantState === "error"
          ? "Voice needs attention"
          : active
            ? "Ready for your next question"
            : "Ready when you are";

  const busy = assistantState === "listening" || assistantState === "thinking";

  return (
    <section className="voice-agent-section" id="voice-agent" aria-labelledby="voice-agent-title">
      <div className="voice-agent-intro">
        <div>
          <h2 id="voice-agent-title">Question the result out loud.</h2>
          <p>
            Ask about the scores, evidence, formula, architecture, or limitations. Answers stay
            inside the documented EgoPrism facts and are spoken with ElevenLabs.
          </p>
        </div>
        <div className="voice-agent-trust">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Grounded answers · server-only key · microphone starts on click</span>
        </div>
      </div>

      <div className="voice-agent-console" data-status={assistantState}>
        <div className="voice-agent-console__head">
          <div className="agent-identity">
            <span className="agent-identity__mark"><Bot aria-hidden="true" size={19} /></span>
            <span><strong>EgoPrism voice analyst</strong><small>ElevenLabs speech · page-grounded answers</small></span>
          </div>
          <span className="agent-status"><i aria-hidden="true" /> {statusLabel}</span>
        </div>

        <div className="agent-transcript" aria-live="polite" aria-label="Voice conversation transcript">
          {transcript.length > 0 ? (
            transcript.slice(-8).map((item) => (
              <div className="agent-message" data-role={item.role} key={item.id}>
                <span>{item.role === "agent" ? "EgoPrism" : "You"}</span>
                <p>{item.text}</p>
              </div>
            ))
          ) : (
            <div className="agent-empty">
              <AudioLines aria-hidden="true" size={25} />
              <p>Start the assistant, then try one of these:</p>
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
                <span>{assistantState === "listening" ? "Listening…" : assistantState === "thinking" ? "Finding answer…" : "Ask by voice"}</span>
              </button>
              <button type="button" className="button button--danger" onClick={endAssistant}>
                <PhoneOff aria-hidden="true" size={17} />
                <span>End conversation</span>
              </button>
            </>
          ) : (
            <button type="button" className="button button--primary" onClick={startAssistant}>
              <Mic aria-hidden="true" size={17} />
              <span>Start voice assistant</span>
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
            onEnded={() => setAssistantState("ready")}
          />
        ) : null}

        <form className="agent-question" onSubmit={askTypedQuestion}>
          <label htmlFor="agent-question-input">Or type a question during the conversation</label>
          <div>
            <input
              id="agent-question-input"
              value={question}
              maxLength={240}
              disabled={!active || busy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={active ? "Ask about the score or evidence…" : "Start the voice assistant first"}
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
            {localError || "Questions map to verified page facts; ElevenLabs generates only the spoken answer."}
          </p>
        </form>
      </div>
    </section>
  );
}
