// ==== Бизнес-логика наград ====
const baseRewards = {5: 250, 4: 100, 3: -500, 2: -2000};
const SUBJECTS = [
  "Алгебра","Биология","Теория вероятности","География","Геометрия","Изо","Английский",
  "Информатика","История","Литература","Математический практикум","Музыка","Практикум по русскому",
  "Русский язык","Технология","Физика","Физкультура"
];



// ==== Firebase ====
// ==== ИНИЦИАЛИЗАЦИЯ FIREBASE И ЗАПУСК ПРИЛОЖЕНИЯ ====
// ==== ИНИЦИАЛИЗАЦИЯ FIREBASE ====
let firebaseReady = false;
window.db = null;

function initFirebase() {
  if (firebaseReady) return;

  // ждём пока env подгрузится
  if (!window.env || !window.env.FIREBASE_API_KEY) {
    console.log("⏳ Ожидание переменных окружения...");
    setTimeout(initFirebase, 200);
    return;
  }

  const firebaseConfig = {
    apiKey: window.env.FIREBASE_API_KEY,
    authDomain: window.env.FIREBASE_AUTH_DOMAIN,
    projectId: window.env.FIREBASE_PROJECT_ID,
    storageBucket: window.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.env.FIREBASE_APP_ID,
    measurementId: window.env.FIREBASE_MEASUREMENT_ID
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    console.log("✅ Firebase инициализирован успешно");
  } else {
    console.log("⚠️ Firebase уже инициализирован");
  }

  window.db = firebase.firestore();
  firebaseReady = true;
}

// запустить инициализацию
initFirebase();


function App(){
  const [subjects] = React.useState(SUBJECTS);
  const [selectedSubject, setSelectedSubject] = React.useState(subjects[0]);
  const [grade, setGrade] = React.useState(5);
  const [cashOutAmount, setCashOutAmount] = React.useState("");

  const [balance, setBalance] = React.useState(0);
  const [history, setHistory] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);

  const [user, setUser] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // ---- Auth
  React.useEffect(()=>{
    return firebase.auth().onAuthStateChanged(u=>{
      setUser(u);
      if(!u){ setHistory([]); setBalance(0); setLoaded(false); }
    });
  },[]);

  // ---- Real-time load
  React.useEffect(()=>{
    if(!user) return;
    const unsub = db.collection("users").doc(user.uid).onSnapshot(doc=>{
      if(doc.exists){
        const data = doc.data();
        setHistory(Array.isArray(data.history)? data.history : []);
        setBalance(typeof data.balance === "number" ? data.balance : 0);
      } else {
        setHistory([]); setBalance(0);
      }
      setLoaded(true);
    }, err => console.error("onSnapshot error:", err));
    return ()=>unsub();
  },[user]);

  // ---- Save
  React.useEffect(()=>{
    if(!loaded || !user) return;
    db.collection("users").doc(user.uid).set({ balance, history })
      .catch(err=>console.error("Save error:", err));
  },[balance, history, loaded, user]);

  // ---- Auth actions
  const register = async ()=>{
    try{
      if(!email || !password) return alert("Введите email и пароль");
      await firebase.auth().createUserWithEmailAndPassword(email.trim(), password);
    }catch(e){ alert(e.message); }
  };
  const login = async ()=>{
    try{
      if(!email || !password) return alert("Введите email и пароль");
      await firebase.auth().signInWithEmailAndPassword(email.trim(), password);
    }catch(e){ alert(e.message); }
  };
  const logout = async ()=>{ await firebase.auth().signOut(); };

  // ---- App logic
  const addGrade = ()=>{
    if(!user) return alert("Сначала войдите в аккаунт");
    const date = new Date().toLocaleDateString("ru-RU");
    let reward = baseRewards[grade] || 0;
    let bonus = 1;
    let bonusDesc = "";

    // дневные бонусы
    const todayGrades = history.filter(h=>h.date===date);
    const todayFives = todayGrades.filter(h=>h.grade===5).length;
    if(grade===5 && todayFives===1){ bonus=2; bonusDesc="Удвоение за 2 пятёрки за день"; }
    if(grade===5 && todayFives===2){ bonus=3; bonusDesc="Утроение за 3 пятёрки за день"; }

    // серии по предмету
    const sameSubject = history.filter(h=>h.subject===selectedSubject);
    const lastTwo = sameSubject.slice(-2).map(e=>e.grade);
    if(grade===5){
      if(lastTwo.length>=2 && lastTwo[0]===5 && lastTwo[1]===5){
        bonus=3.5; bonusDesc="Хет-трик 3 пятёрки подряд по предмету";
      }else if(lastTwo.length>=1 && lastTwo[0]===5){
        bonus=2.5; bonusDesc="Бонус 2.5 за 2 подряд по предмету";
      }
    }

    const total = reward * bonus;
    setBalance(balance + total);
    setHistory([{date, subject:selectedSubject, grade, reward: total, bonus: bonusDesc}, ...history]);
  };

  const deleteEntry = (i)=>{
    const e = history[i];
    setBalance(balance - e.reward);
    const arr = [...history]; arr.splice(i,1);
    setHistory(arr);
  };

  const cashOut = ()=>{
    if(!user) return alert("Сначала войдите в аккаунт");
    const amount = Number(cashOutAmount);
    if(!amount || amount<=0) return alert("Введите корректную сумму");
    if(amount>balance) return alert("Сумма больше баланса");
    if(window.confirm(`Выдать ${amount} ₽ и уменьшить баланс?`)){
      const date = new Date().toLocaleDateString("ru-RU");
      setHistory([{date, subject:"💸 Вывод средств", grade:"—", reward: -amount, bonus:"Частичный вывод"}, ...history]);
      setBalance(balance - amount);
      setCashOutAmount("");
    }
  };

  const exportCSV = ()=>{
    if(!history || history.length===0){ alert("История пуста"); return; }
    const header = ["Дата","Предмет","Оценка","Бонус","Сумма"];
    const rows = history.map(h=>[
      h.date || "",
      h.subject || "",
      h.grade || "",
      h.bonus || "",
      (typeof h.reward === "number" ? h.reward : "")
    ]);
    const csv = [header, ...rows]
      .map(r=>r.map(i=>`"${String(i).replace(/"/g,'""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `history_${new Date().toLocaleDateString("ru-RU")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const importCSV = (file)=>{
    if(!user) return alert("Сначала войдите в аккаунт");
    const reader = new FileReader();
    reader.onload = (evt)=>{
      const text = evt.target.result;
      const lines = text.trim().split(/\r?\n/);
      if(lines.length<2) return alert("Файл пуст или неверный формат");
      const data = lines.slice(1).map(line=>{
        const p = line
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map(x=>x.replace(/^"|"$/g,'').replace(/""/g,'"'));
        return {date:p[0], subject:p[1], grade:p[2], bonus:p[3], reward:Number(p[4])};
      });
      const total = data.reduce((s,x)=>s+(isFinite(x.reward)?x.reward:0),0);
      if(window.confirm("Загрузить историю из файла и заменить текущую?")){
        setHistory(data); setBalance(total);
      }
      // сбрасываем value, чтобы можно было выбрать тот же файл повторно
      const input = document.getElementById('importFile');
      if (input) input.value = "";
    };
    reader.readAsText(file,'UTF-8');
  };

  // ---- Sidebar listeners (панель, экспорт/импорт)
  React.useEffect(()=>{
  const burger = document.getElementById('burgerBtn');
  const sidebar = document.getElementById('sidebar');
  const close = document.getElementById('closeSidebar');
  const exportBtn = document.getElementById('exportBtn');
  const importFile = document.getElementById('importFile');

  if(!burger || !sidebar || !close || !exportBtn || !importFile) return;

  const open = (e)=>{
    e.stopPropagation();            // важно: не дать клику сразу закрыть
    sidebar.classList.add('open');
  };
  const closeFn = ()=>sidebar.classList.remove('open');
  const onExport = ()=>exportCSV();
  const onImportChange = (e)=>{ if(e.target.files[0]) importCSV(e.target.files[0]); };

  // закрытие при клике вне панели
  const clickOutside = (e)=>{
    if (sidebar.classList.contains('open')
        && !sidebar.contains(e.target)
        && !burger.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  };

  burger.addEventListener('click', open);
  close.addEventListener('click', closeFn);
  exportBtn.addEventListener('click', onExport);
  importFile.addEventListener('change', onImportChange);
  document.addEventListener('click', clickOutside);

  return ()=>{
    burger.removeEventListener('click', open);
    close.removeEventListener('click', closeFn);
    exportBtn.removeEventListener('click', onExport);
    importFile.removeEventListener('change', onImportChange);
    document.removeEventListener('click', clickOutside);
  };
},[history, user]); // зависимость нужна, чтобы экспорт видел актуальные данные

  // ---- UI
  return (
    <div className="stack container">
     {!user ? (
  <div className="card auth-card" style={{textAlign: 'center'}}>
    <img src="logo.png" alt="Логотип" style={{width: '160px', marginBottom: '16px'}} />
    <h2>Вход / Регистрация</h2>
          <div className="auth-fields">
            <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input placeholder="Пароль" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          </div>
          <div className="auth-actions">
            <button onClick={login}>Войти</button>
            <button onClick={register}>Регистрация</button>
          </div>
          <div className="muted" style={{marginTop:'16px'}}>Учись и заработай на мечту вместе с TakeFive</div>
        </div>
      ) : (
        <div className="card" style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px'}}>
          <div className="row">
            <span className="material-icons" style={{color:'var(--md-primary)'}}>account_circle</span>
            <div>
              <div style={{fontWeight:700}}>{user.email}</div>
              <div className="muted">Вы авторизованы</div>
            </div>
          </div>
          <button className="text-btn" onClick={logout}>Выйти</button>
        </div>
      )}

      {user && (
        <React.Fragment>
          <div className="card">
            <div className="row">
              <select value={selectedSubject} onChange={e=>setSelectedSubject(e.target.value)}>
                {subjects.map(s=><option key={s}>{s}</option>)}
              </select>
              <select value={grade} onChange={e=>setGrade(Number(e.target.value))}>
                {[5,4,3,2].map(g=><option key={g} value={g}>{g}</option>)}
              </select>
              <button onClick={addGrade}>
                <span className="material-icons" style={{verticalAlign:'middle',marginRight:'6px'}}>add</span>
                Добавить
              </button>
            </div>
          </div>

          <div className="card balance-card">
            <div className="row" style={{justifyContent:'space-between'}}>
              <div className="value">Баланс: {balance} ₽</div>
              <div className="cashout">
                <input className="cashout-input" type="number" placeholder="Сумма вывода" value={cashOutAmount} onChange={e=>setCashOutAmount(e.target.value)} />
                <button onClick={cashOut}>
                  <span className="material-icons" style={{verticalAlign:'middle',marginRight:'6px'}}>paid</span>
                  Вывести
                </button>
              </div>
            </div>
          </div>
                    {/* ==== Боевой пропуск ==== */}
<div className="card battle-pass">
  <h3 style={{ marginTop: 0 }}>🏆 Боевой пропуск сезона 1</h3>
  <p className="muted">«Осенний апгрейд знаний»</p>

  <div className="xp-section">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontWeight: 600 }}>Уровень: 6 / 10</div>
      <div style={{ fontWeight: 600, color: "#2196f3" }}>XP: 1350 / 2000</div>
    </div>
    <div className="progress-bar large">
      <div className="progress-fill" style={{ width: "68%" }}></div>
    </div>
  </div>

  <h4 style={{ marginTop: "16px" }}>🎯 Задания</h4>
  <ul className="bp-tasks">
    <li className="done">✅ Получи 3 пятёрки подряд — <b>+100 XP</b></li>
    <li className="done">✅ Сделай 10 оценок за неделю — <b>+200 XP</b></li>
    <li>🔲 Сохрани streak 5 дней — <b>+250 XP</b></li>
  </ul>

  <h4 style={{ marginTop: "16px" }}>🎁 Награды</h4>
  <div className="rewards-grid">
    {[
      { lvl: 1, reward: "+100 ₽" },
      { lvl: 2, reward: "Стикер" },
      { lvl: 3, reward: "+200 ₽" },
      { lvl: 4, reward: "Бейдж «Отличник»" },
      { lvl: 5, reward: "Бонус ×2 на день" },
      { lvl: 10, reward: "💎 Супернаграда" }
    ].map((r, i) => (
      <div key={i} className={`reward ${r.lvl <= 6 ? "unlocked" : ""}`}>
        <div className="lvl">Ур.{r.lvl}</div>
        <div className="val">{r.reward}</div>
      </div>
    ))}
  </div>
</div>

          <div className="card history">
            <h3 style={{marginTop:0}}>История</h3>
            {history.length===0 && <p className="muted">Пока нет оценок.</p>}
            {history.map((h,i)=>(
              <div key={i} className="entry">
                <div>
                  <div><b>{h.date}</b> — {h.subject}: <b className={h.reward>=0?"":"negative"}>{h.grade}</b></div>
                  {h.bonus && <div className="bonus">{h.bonus}</div>}
                </div>
                <div className="row" style={{alignItems:'center'}}>
                  <div style={{minWidth:'90px', textAlign:'right', fontWeight:700}}>
                    {h.reward>=0?`+${h.reward}`:`${h.reward}`} ₽
                  </div>
                  <button className="text-btn" title="Удалить" onClick={()=>deleteEntry(i)}>
                    <span className="material-icons">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

{/* ==== Админка боевого пропуска ==== */}
<div className="card battle-pass-admin" id="battlePassAdminPanel" style={{ display: "none" }}>
  <h3>⚙️ Администрирование боевого пропуска</h3>

  <div className="section">
    <h4>🎯 Задания</h4>
    <ul className="admin-list" id="taskList">
      <li>✅ Получи 3 пятёрки подряд — <b>+100 XP</b></li>
      <li>✅ Сделай 10 оценок за неделю — <b>+200 XP</b></li>
    </ul>
    <div className="row">
      <input type="text" id="newTaskName" placeholder="Название задания" />
      <input type="number" id="newTaskXP" placeholder="XP" style={{ width: "80px" }} />
      <button id="addTaskBtn">Добавить</button>
    </div>
  </div>

  <div className="section">
    <h4>🎁 Награды</h4>
    <ul className="admin-list" id="rewardList">
      <li>Уровень 1 — +100 ₽</li>
      <li>Уровень 2 — Стикер</li>
    </ul>
    <div className="row">
      <input type="number" id="newRewardLvl" placeholder="Уровень" style={{ width: "80px" }} />
      <input type="text" id="newRewardText" placeholder="Награда" />
      <button id="addRewardBtn">Добавить</button>
    </div>
  </div>

  <div className="section" style={{ textAlign: "right", marginTop: "10px" }}>
    <button id="resetSeason" className="danger-btn">Сбросить сезон</button>
  </div>
</div>
              
        </React.Fragment>
      )}
        {user && (
        <button className="burger" id="burgerBtn" title="Админ-панель">
          <span className="material-icons">menu</span>
        </button>
      )}
    </div>
  );
}

function startAppWhenReady() {
  if (!firebaseReady) {
    console.log("⏳ Ждём готовности Firebase перед запуском React...");
    setTimeout(startAppWhenReady, 200);
    return;
  }
  if (!window.__react_root__) {
    window.__react_root__ = ReactDOM.createRoot(document.getElementById("root"));
    window.__react_root__.render(<App />);
  }
}
startAppWhenReady();
