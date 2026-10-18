// Помощник-дроид Пятик: живёт в углу экрана, здоровается, реагирует на оценки и шутит по клику.
// Тексты и выбор реакции — в src/domain/buddy.js; здесь только показ и анимация.
import React from "react";
import { BUDDY_NAME, gradeReaction, pickLine, greeting } from "./domain/buddy.js";

const HIDDEN_KEY = "takefive:buddyHidden";
const MOOD_MS = 3000;   // сколько длится анимация реакции (дольше прыжков и искр)
const BUBBLE_MS = 7000; // сколько висит облачко

function readHidden(){
  try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; }
}
function saveHidden(hidden){
  try { hidden ? localStorage.setItem(HIDDEN_KEY, "1") : localStorage.removeItem(HIDDEN_KEY); } catch { /* хранилище недоступно */ }
}

function Droid(){
  return (
    <svg className="buddy-svg" viewBox="0 0 120 150" aria-hidden="true">
      <ellipse className="buddy-shadow" cx="60" cy="144" rx="26" ry="4" />
      <g className="buddy-float">
        <g className="buddy-arm buddy-arm-l">
          <path d="M34 96 L18 114" />
          <circle cx="17" cy="116" r="5" />
        </g>
        <g className="buddy-arm buddy-arm-r">
          <path d="M86 96 L102 114" />
          <circle cx="103" cy="116" r="5" />
        </g>
        <circle className="buddy-body" cx="60" cy="106" r="30" />
        <circle className="buddy-core" cx="60" cy="106" r="13" />
        <text className="buddy-five" x="60" y="112" textAnchor="middle">5</text>
        <rect className="buddy-neck" x="52" y="68" width="16" height="10" rx="3" />
        <g className="buddy-head">
          <line className="buddy-antenna" x1="60" y1="24" x2="60" y2="10" />
          <circle className="buddy-antenna-light" cx="60" cy="8" r="5" />
          <rect className="buddy-skull" x="26" y="22" width="68" height="50" rx="25" />
          <rect className="buddy-screen" x="34" y="31" width="52" height="31" rx="15" />
          <g className="buddy-eyes buddy-eyes-open">
            <circle cx="49" cy="44" r="5" />
            <circle cx="71" cy="44" r="5" />
          </g>
          <g className="buddy-eyes-happy">
            <path d="M44 46 Q49 39 54 46" />
            <path d="M66 46 Q71 39 76 46" />
          </g>
          <path className="buddy-mouth buddy-mouth-smile" d="M54 53 Q60 58 66 53" />
          <path className="buddy-mouth buddy-mouth-oops" d="M54 55 Q57 52 60 55 Q63 58 66 55" />
          <circle className="buddy-cheek" cx="40" cy="53" r="3" />
          <circle className="buddy-cheek" cx="80" cy="53" r="3" />
          <path className="buddy-drop" d="M92 30 Q95 36 92 38 Q89 36 92 30 Z" />
        </g>
      </g>
    </svg>
  );
}

export default function Buddy({ event }){
  const [hidden, setHidden] = React.useState(readHidden);
  const [line, setLine] = React.useState(null);
  const [mood, setMood] = React.useState("idle");
  const [beat, setBeat] = React.useState(0); // новый beat перезапускает анимацию даже при том же настроении
  const mountEvent = React.useRef(event);   // событие, бывшее до появления дроида (например, от прошлого входа), — не наше
  const prevIndex = React.useRef({});
  const timers = React.useRef([]);

  const say = React.useCallback((kind, vars, nextMood) => {
    const { text, index } = pickLine(kind, vars, prevIndex.current[kind]);
    prevIndex.current[kind] = index;
    timers.current.forEach(clearTimeout);
    setLine({ text, key: Date.now() });
    setMood(nextMood);
    setBeat(b => b + 1);
    timers.current = [
      setTimeout(() => setMood("idle"), MOOD_MS),
      setTimeout(() => setLine(null), BUBBLE_MS)
    ];
  }, []);

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Приветствие при входе — чуть позже цитаты, чтобы не появлялись одновременно
  React.useEffect(() => {
    const t = setTimeout(() => say("greet", { hello: greeting(new Date().getHours()) }, "wave"), 1200);
    return () => clearTimeout(t);
  }, [say]);

  React.useEffect(() => {
    if (!event || event === mountEvent.current) return;
    const { kind, mood: nextMood, vars } = gradeReaction(event.entry, event.tasksDone);
    say(kind, vars, nextMood);
  }, [event, say]);

  const hide = () => { setHidden(true); saveHidden(true); };
  const show = () => { setHidden(false); saveHidden(false); say("joke", {}, "wave"); };

  if (hidden) {
    return (
      <button className="buddy-restore" onClick={show} title={`Позвать ${BUDDY_NAME}а`} aria-label={`Позвать помощника ${BUDDY_NAME}а`}>
        <Droid />
      </button>
    );
  }

  return (
    <div className={`buddy buddy--${mood}`}>
      <div className="buddy-say" role="status" aria-live="polite">
        {line && (
          <div className="buddy-bubble" key={line.key}>
            <div className="buddy-name">{BUDDY_NAME}</div>
            <div>{line.text}</div>
            <button className="buddy-close" onClick={() => setLine(null)} aria-label="Закрыть сообщение">×</button>
          </div>
        )}
      </div>
      <button className="buddy-bot" onClick={() => say("joke", {}, "talk")} title="Нажми — расскажу шутку" aria-label={`${BUDDY_NAME}: расскажи шутку`}>
        <span className="buddy-motion" key={beat}>
          <Droid />
          {mood === "party" && (
            <span className="buddy-sparks" aria-hidden="true">
              {["✨","⭐","💰","✨","⭐","🎉"].map((s, i) => <span key={i} style={{ "--i": i }}>{s}</span>)}
            </span>
          )}
        </span>
      </button>
      <button className="buddy-hide" onClick={hide} title="Спрятать помощника" aria-label="Спрятать помощника">
        <span className="material-icons">expand_more</span>
      </button>
    </div>
  );
}
