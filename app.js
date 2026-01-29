// ==== Версия приложения ====
const APP_VERSION = "v1.2.2";

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
  const [gradeDate, setGradeDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [cashOutAmount, setCashOutAmount] = React.useState("");
  const [showBPAdmin, setShowBPAdmin] = React.useState(false);
  const [adminAccess, setAdminAccess] = React.useState(false);
  const [adminCode, setAdminCode] = React.useState("");

  const [balance, setBalance] = React.useState(0);
  const [history, setHistory] = React.useState([]);
  const [loaded, setLoaded] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [historyReadyForSave, setHistoryReadyForSave] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  const [user, setUser] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // ---- Battle Pass State
  const [battlePass, setBattlePass] = React.useState({
    xp: 0,
    level: 0,
    season: 1,
    seasonName: "Осенний апгрейд знаний",
    maxLevel: 10,
    xpPerLevel: 200, // XP нужно на каждый уровень
    tasks: [],
    rewards: [],
    completedTasks: [], // массив ID выполненных заданий
    claimedRewards: [] // массив ID полученных наград
  });

  // ---- BP Admin State
  const [newTaskName, setNewTaskName] = React.useState("");
  const [newTaskXP, setNewTaskXP] = React.useState("");
  const [newTaskType, setNewTaskType] = React.useState("streak_fives");
  const [newTaskTarget, setNewTaskTarget] = React.useState("");
  const [newRewardLevel, setNewRewardLevel] = React.useState("");
  const [newRewardText, setNewRewardText] = React.useState("");
  const [newRewardType, setNewRewardType] = React.useState("other");
  const [newRewardAmount, setNewRewardAmount] = React.useState("");
  const [bpUnsavedChanges, setBpUnsavedChanges] = React.useState(false);

  // ---- History Pagination State
  const [showAllHistory, setShowAllHistory] = React.useState(false);

  // ---- Auth
  React.useEffect(()=>{
    return firebase.auth().onAuthStateChanged(u=>{
      setUser(u);
      if(!u){ setHistory([]); setBalance(0); setLoaded(false); setHistoryReadyForSave(true); }
    });
  },[]);

  // ---- Real-time load
  React.useEffect(()=>{
    if(!user) return;
  const unsub = db.collection("users").doc(user.uid).onSnapshot(
  (doc) => {
    // Получены данные с сервера
    setHydrated(true);

    if (doc.exists) {
      const data = doc.data();
      const rawHistory = data.history;
      let normalizedHistory = [];
      let historyIsSafeToPersist = true;

      if (Array.isArray(rawHistory)) {
        normalizedHistory = rawHistory;
      } else if (rawHistory == null) {
        normalizedHistory = [];
      } else {
        console.warn("history некорректного типа, автосохранение отключено", rawHistory);
        historyIsSafeToPersist = false;
        normalizedHistory = [];
      }

      // НЕ перезаписываем локальное состояние пока идет сохранение
      if (historyIsSafeToPersist && !isSaving) {
        setHistory(normalizedHistory);
        setBalance(typeof data.balance === "number" ? data.balance : 0);
      }
      setHistoryReadyForSave(historyIsSafeToPersist);

      // Загружаем данные боевого пропуска
      if(data.battlePass){
        setBattlePass(prev => ({
          ...prev,
          ...data.battlePass,
          // Обеспечиваем наличие всех полей
          tasks: data.battlePass.tasks || [],
          rewards: data.battlePass.rewards || [],
          completedTasks: data.battlePass.completedTasks || [],
          claimedRewards: data.battlePass.claimedRewards || []
        }));
        setBpUnsavedChanges(false); // Сбрасываем флаг после загрузки
      }

    } else {
      setHistory([]);
      setBalance(0);
      setHistoryReadyForSave(true);
    }

    setLoaded(true);
  },
  (err) => console.error("onSnapshot error:", err)
);
    return ()=>unsub();
  },[user]);

  // ---- Save (автосохранение только баланса и истории)
  React.useEffect(()=>{
  if(!loaded || !user || !historyReadyForSave || !hydrated) return;

  setIsSaving(true);
  db.collection("users").doc(user.uid).set(
    { balance, history },
    { merge: true }
  )
      .then(() => {
        setTimeout(() => setIsSaving(false), 500); // Даем время onSnapshot обработать
      })
      .catch(err => {
        console.error("Save error:", err);
        setIsSaving(false);
      });
  },[balance, history, historyReadyForSave, loaded, user, hydrated]);

  // ---- Auto-save battlePass ОТКЛЮЧЕНО - вызывало Quota exceeded
  // Игровой прогресс сохраняется вместе с настройками админки через кнопку "Сохранить"
  // React.useEffect(()=>{
  //   if(!loaded || !user || !hydrated) return;
  //   if(bpUnsavedChanges) return;
  //   db.collection("users").doc(user.uid).update({
  //     'battlePass.xp': battlePass.xp,
  //     'battlePass.level': battlePass.level,
  //     'battlePass.completedTasks': battlePass.completedTasks,
  //     'battlePass.claimedRewards': battlePass.claimedRewards
  //   })
  //       .catch(err=>console.error("BattlePass save error:", err));
  // },[battlePass.xp, battlePass.level, battlePass.completedTasks, battlePass.claimedRewards, loaded, user, hydrated, bpUnsavedChanges]);



  
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

  // ---- Statistics calculation
  const calculateStats = ()=>{
    const stats = {2: 0, 3: 0, 4: 0, 5: 0};
    let totalGrades = 0;
    let totalSum = 0;

    history.forEach(entry => {
      const g = entry.grade;
      if(g === 2 || g === 3 || g === 4 || g === 5){
        stats[g]++;
        totalGrades++;
        totalSum += g;
      }
    });

    const average = totalGrades > 0 ? (totalSum / totalGrades).toFixed(2) : 0;
    const maxCount = Math.max(stats[2], stats[3], stats[4], stats[5], 1);

    return { stats, average, maxCount, totalGrades };
  };

  // ---- History filtering (последние 5 дней)
  const getFilteredHistory = () => {
    if(showAllHistory || history.length === 0) return history;

    const now = new Date();
    const fiveDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);

    const recentHistory = history.filter(entry => {
      const parts = entry.date.split('.');
      if(parts.length === 3){
        const entryDate = new Date(parts[2], parts[1] - 1, parts[0]);
        return entryDate >= fiveDaysAgo;
      }
      return true; // Если дата некорректная, показываем запись
    });

    // Если за 5 дней ничего нет, показываем первые 5 записей
    return recentHistory.length > 0 ? recentHistory : history.slice(0, 5);
  };

  // ---- Battle Pass функции
  // Расчёт уровня по XP (уровень начинается с 0)
  const getLevelFromXP = (xp) => {
    const level = Math.floor(xp / battlePass.xpPerLevel);
    return Math.min(level, battlePass.maxLevel);
  };

  // Расчёт XP для текущего уровня
  const getCurrentLevelProgress = () => {
    const currentLevelXP = battlePass.level * battlePass.xpPerLevel;
    const xpInCurrentLevel = battlePass.xp - currentLevelXP;
    return {
      current: xpInCurrentLevel,
      needed: battlePass.xpPerLevel,
      percentage: Math.min((xpInCurrentLevel / battlePass.xpPerLevel) * 100, 100)
    };
  };

  // Добавление XP
  const addXP = (amount, reason) => {
    const newXP = battlePass.xp + amount;
    const newLevel = getLevelFromXP(newXP);
    const oldLevel = battlePass.level;

    setBattlePass(prev => {
      const updated = {
        ...prev,
        xp: newXP,
        level: newLevel
      };

      // Автосохранение игрового прогресса
      if(user && loaded){
        db.collection("users").doc(user.uid).set({
          battlePass: {
            xp: newXP,
            level: newLevel,
            completedTasks: prev.completedTasks,
            claimedRewards: prev.claimedRewards
          }
        }, { merge: true }).catch(err => console.error("Auto-save XP error:", err));
      }

      return updated;
    });

    // Уведомление о повышении уровня
    if(newLevel > oldLevel){
      alert(`🎉 Поздравляем! Достигнут уровень ${newLevel}! Проверьте награды.`);
    }
  };

  // Отметить задание как выполненное
  const completeTask = (taskId, xpReward) => {
    if(battlePass.completedTasks.includes(taskId)) return; // уже выполнено

    setBattlePass(prev => {
      const updated = {
        ...prev,
        completedTasks: [...prev.completedTasks, taskId]
      };

      // Автосохранение
      if(user && loaded){
        db.collection("users").doc(user.uid).set({
          battlePass: {
            completedTasks: updated.completedTasks
          }
        }, { merge: true }).catch(err => console.error("Auto-save task error:", err));
      }

      return updated;
    });

    addXP(xpReward, `Выполнено задание`);
  };

  // Получить награду
  const claimReward = (rewardId) => {
    const reward = battlePass.rewards.find(r => r.id === rewardId);
    if(!reward || battlePass.claimedRewards.includes(rewardId)) return;

    // Проверка уровня
    if(battlePass.level < reward.level){
      alert(`Эта награда доступна на уровне ${reward.level}`);
      return;
    }

    setBattlePass(prev => {
      const updated = {
        ...prev,
        claimedRewards: [...prev.claimedRewards, rewardId]
      };

      // Автосохранение
      if(user && loaded){
        db.collection("users").doc(user.uid).set({
          battlePass: {
            claimedRewards: updated.claimedRewards
          }
        }, { merge: true }).catch(err => console.error("Auto-save reward error:", err));
      }

      return updated;
    });

    // Если награда денежная - добавляем на баланс
    if(reward.type === 'money' && reward.amount){
      const date = new Date().toLocaleDateString("ru-RU");
      setBalance(balance + reward.amount);
      setHistory([{
        date,
        subject: `🏆 Награда BP (Ур.${reward.level})`,
        grade: "—",
        reward: reward.amount,
        bonus: reward.text
      }, ...history]);
      alert(`✅ ${reward.text} зачислено на баланс!`);
    } else {
      alert(`✅ Награда "${reward.text}" отмечена как полученная!`);
    }
  };

  // Проверка заданий боевого пропуска
  const checkBattlePassTasks = (updatedHistory) => {
    battlePass.tasks.forEach(task => {
      // Пропускаем уже выполненные задания
      if(battlePass.completedTasks.includes(task.id)) return;

      let completed = false;

      // Проверка по типу задания
      if(task.type === 'streak_fives'){
        // Проверка N пятёрок подряд
        const recentGrades = updatedHistory.slice(0, task.target || 3);
        const allFives = recentGrades.every(h => h.grade === 5);
        if(recentGrades.length >= (task.target || 3) && allFives){
          completed = true;
        }
      } else if(task.type === 'total_grades_week'){
        // Проверка N оценок за неделю
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekGrades = updatedHistory.filter(h => {
          const parts = h.date.split('.');
          if(parts.length === 3){
            const entryDate = new Date(parts[2], parts[1]-1, parts[0]);
            return entryDate >= weekAgo;
          }
          return false;
        });
        if(weekGrades.length >= (task.target || 10)){
          completed = true;
        }
      } else if(task.type === 'average_score'){
        // Проверка среднего балла
        const { average } = calculateStats();
        if(parseFloat(average) >= (task.target || 4.5)){
          completed = true;
        }
      }

      if(completed){
        completeTask(task.id, task.xp || 100);
      }
    });
  };

  // ---- BP Admin функции
  const saveBattlePass = async () => {
    if(!user) return;

    try {
      // Сохраняем весь battlePass используя set с merge: true
      // Это создаст поля если их нет, или обновит если они существуют
      const dataToSave = {
        battlePass: {
          season: battlePass.season,
          seasonName: battlePass.seasonName,
          maxLevel: battlePass.maxLevel,
          xpPerLevel: battlePass.xpPerLevel,
          tasks: battlePass.tasks,
          rewards: battlePass.rewards,
          xp: battlePass.xp,
          level: battlePass.level,
          completedTasks: battlePass.completedTasks,
          claimedRewards: battlePass.claimedRewards
        }
      };

      await db.collection("users").doc(user.uid).set(dataToSave, { merge: true });

      setBpUnsavedChanges(false);
      alert("✅ Изменения боевого пропуска сохранены!");
    } catch(err) {
      console.error("❌ Ошибка сохранения:", err);
      alert("❌ Ошибка при сохранении: " + err.message);
    }
  };

  const addTask = () => {
    if(!newTaskName.trim() || !newTaskXP) {
      alert("Введите название и XP для задания");
      return;
    }

    const task = {
      id: Date.now().toString(),
      name: newTaskName.trim(),
      xp: Number(newTaskXP),
      type: newTaskType
    };

    // Добавляем target только если указан
    if(newTaskTarget) {
      task.target = Number(newTaskTarget);
    }

    setBattlePass(prev => ({
      ...prev,
      tasks: [...prev.tasks, task]
    }));
    setBpUnsavedChanges(true);

    // Очистка формы
    setNewTaskName("");
    setNewTaskXP("");
    setNewTaskTarget("");
  };

  const deleteTask = (taskId) => {
    if(!confirm("Удалить это задание?")) return;

    setBattlePass(prev => ({
      ...prev,
      tasks: prev.tasks.filter(t => t.id !== taskId)
    }));
    setBpUnsavedChanges(true);
  };

  const addReward = () => {
    if(!newRewardLevel || !newRewardText.trim()) {
      alert("Введите уровень и описание награды");
      return;
    }

    const reward = {
      id: Date.now().toString(),
      level: Number(newRewardLevel),
      text: newRewardText.trim(),
      type: newRewardType
    };

    // Добавляем amount только если это деньги и сумма указана
    if(newRewardType === 'money' && newRewardAmount) {
      reward.amount = Number(newRewardAmount);
    }

    setBattlePass(prev => ({
      ...prev,
      rewards: [...prev.rewards, reward].sort((a, b) => a.level - b.level)
    }));
    setBpUnsavedChanges(true);

    // Очистка формы
    setNewRewardLevel("");
    setNewRewardText("");
    setNewRewardAmount("");
  };

  const deleteReward = (rewardId) => {
    if(!confirm("Удалить эту награду?")) return;

    setBattlePass(prev => ({
      ...prev,
      rewards: prev.rewards.filter(r => r.id !== rewardId)
    }));
    setBpUnsavedChanges(true);
  };

  const resetSeason = () => {
    if(!confirm("Точно сбросить сезон? Это удалит все задания, награды и прогресс!")) return;

    setBattlePass(prev => ({
      ...prev,
      xp: 0,
      level: 0,
      tasks: [],
      rewards: [],
      completedTasks: [],
      claimedRewards: []
    }));
    setBpUnsavedChanges(true);

    alert("✅ Боевой пропуск сброшен!");
  };

  // ---- App logic
  const recalculateHistory = (entries) => {
    const sorted = [...entries].sort((a,b) => {
      const [da,ma,ya] = a.date.split('.'), [db,mb,yb] = b.date.split('.');
      const diff = new Date(ya,ma-1,da) - new Date(yb,mb-1,db);
      return diff !== 0 ? diff : (parseInt(a.id)||0) - (parseInt(b.id)||0);
    });
    const result = [];
    for (const entry of sorted) {
      if (typeof entry.grade !== 'number') { result.push(entry); continue; }
      let reward = baseRewards[entry.grade] || 0;
      let bonus = 1, bonusDesc = "";
      const dayGrades = result.filter(h => h.date === entry.date && typeof h.grade === 'number');
      const dayFives = dayGrades.filter(h => h.grade === 5).length;
      if(entry.grade===5 && dayFives===1){ bonus=2; bonusDesc="Удвоение за 2 пятёрки за день"; }
      if(entry.grade===5 && dayFives===2){ bonus=3; bonusDesc="Утроение за 3 пятёрки за день"; }
      const daySameSubject = result.filter(h => h.date === entry.date && h.subject === entry.subject && typeof h.grade === 'number');
      const lastTwo = daySameSubject.slice(-2).map(e => e.grade);
      if(entry.grade===5){
        if(lastTwo.length>=2 && lastTwo[0]===5 && lastTwo[1]===5){
          bonus=3.5; bonusDesc="Хет-трик 3 пятёрки подряд по предмету";
        }else if(lastTwo.length>=1 && lastTwo[lastTwo.length-1]===5){
          bonus=2.5; bonusDesc="Бонус 2.5 за 2 подряд по предмету";
        }
      }
      result.push({...entry, reward: reward * bonus, bonus: bonusDesc});
    }
    result.sort((a,b) => {
      const [da,ma,ya] = a.date.split('.'), [db,mb,yb] = b.date.split('.');
      const diff = new Date(yb,mb-1,db) - new Date(ya,ma-1,da);
      return diff !== 0 ? diff : (parseInt(b.id)||0) - (parseInt(a.id)||0);
    });
    return result;
  };

  const addGrade = ()=>{
    if(!user) return alert("Сначала войдите в аккаунт");
    const [y, m, d] = gradeDate.split('-');
    const date = `${d}.${m}.${y}`;
    let reward = baseRewards[grade] || 0;
    let bonus = 1;
    let bonusDesc = "";

    // дневные бонусы
    const todayGrades = history.filter(h=>h.date===date);
    const todayFives = todayGrades.filter(h=>h.grade===5).length;
    if(grade===5 && todayFives===1){ bonus=2; bonusDesc="Удвоение за 2 пятёрки за день"; }
    if(grade===5 && todayFives===2){ bonus=3; bonusDesc="Утроение за 3 пятёрки за день"; }

    // серии по предмету (только сегодняшние записи!)
    const todaySameSubject = history.filter(h => h.date === date && h.subject === selectedSubject)
      .sort((a,b) => (parseInt(a.id)||0) - (parseInt(b.id)||0));
    const lastTwo = todaySameSubject.slice(-2).map(e=>e.grade);
    if(grade===5){
      if(lastTwo.length>=2 && lastTwo[0]===5 && lastTwo[1]===5){
        bonus=3.5; bonusDesc="Хет-трик 3 пятёрки подряд по предмету";
      }else if(lastTwo.length>=1 && lastTwo[lastTwo.length-1]===5){
        bonus=2.5; bonusDesc="Бонус 2.5 за 2 подряд по предмету";
      }
    }

    const total = reward * bonus;
    setBalance(balance + total);
    setHistoryReadyForSave(true);
    const newEntry = {id: Date.now().toString(), date, subject:selectedSubject, grade, reward: total, bonus: bonusDesc};
    const updatedHistory = [newEntry, ...history].sort((a,b) => {
      const [da,ma,ya] = a.date.split('.'), [db,mb,yb] = b.date.split('.');
      const diff = new Date(yb,mb-1,db) - new Date(ya,ma-1,da);
      return diff !== 0 ? diff : (parseInt(b.id)||0) - (parseInt(a.id)||0);
    });
    setHistory(updatedHistory);

    // Проверяем задания боевого пропуска
    checkBattlePassTasks(updatedHistory);
  };

  const deleteEntry = (i)=>{
    const arr = [...history]; arr.splice(i,1);
    const recalculated = recalculateHistory(arr);
    const newBalance = recalculated.reduce((sum, e) => sum + (typeof e.reward === 'number' ? e.reward : 0), 0);
    setBalance(newBalance);
    setHistoryReadyForSave(true);
    setHistory(recalculated);
  };

  const cashOut = ()=>{
    if(!user) return alert("Сначала войдите в аккаунт");
    const amount = Number(cashOutAmount);
    if(!amount || amount<=0) return alert("Введите корректную сумму");
    if(amount>balance) return alert("Сумма больше баланса");
    if(window.confirm(`Выдать ${amount} ₽ и уменьшить баланс?`)){
      const date = new Date().toLocaleDateString("ru-RU");
      setHistoryReadyForSave(true);
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
        setHistoryReadyForSave(true);
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
    const bpBtn = document.getElementById('battlePassAdmin');

  if(!burger || !sidebar || !close || !exportBtn || !importFile) return;

  const open = (e)=>{
    e.stopPropagation();            // важно: не дать клику сразу закрыть
    sidebar.classList.add('open');
  };
  const closeFn = ()=>sidebar.classList.remove('open');
  const onExport = ()=>exportCSV();
  const onImportChange = (e)=>{ if(e.target.files[0]) importCSV(e.target.files[0]); };
  const onBP = () => {
  const code = prompt("Введите код доступа для открытия админки:");
  if (code === "1234") { // ← можешь поставить свой секретный код
    setAdminAccess(true);
    setShowBPAdmin(true);
    alert("✅ Доступ разрешён");
  } else {
    alert("⛔ Неверный код доступа");
  }
  closeFn();
};

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
  if (bpBtn) bpBtn.addEventListener('click', onBP);

  return ()=>{
    burger.removeEventListener('click', open);
    close.removeEventListener('click', closeFn);
    exportBtn.removeEventListener('click', onExport);
    importFile.removeEventListener('change', onImportChange);
    document.removeEventListener('click', clickOutside);
  if (bpBtn) bpBtn.removeEventListener('click', onBP);
  };
},[history, user]); // зависимость нужна, чтобы экспорт видел актуальные данные

  // ---- UI
  return (
    <div className="stack container">
     {/* Версия приложения */}
     <div className="app-version">{APP_VERSION}</div>

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
              <input type="date" value={gradeDate} onChange={e=>setGradeDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
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

          {/* ==== Статистика оценок ==== */}
          {(() => {
            const { stats, average, maxCount, totalGrades } = calculateStats();
            return (
              <div className="card stats-card">
                <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span className="material-icons" style={{color:'var(--md-primary)'}}>bar_chart</span>
                  Статистика оценок
                </h3>
                {totalGrades === 0 ? (
                  <p className="muted">Пока нет оценок для отображения статистики</p>
                ) : (
                  <React.Fragment>
                    <div className="stats-summary">
                      <div className="stat-item">
                        <div className="stat-label">Всего оценок</div>
                        <div className="stat-value">{totalGrades}</div>
                      </div>
                      <div className="stat-item">
                        <div className="stat-label">Средний балл</div>
                        <div className="stat-value" style={{color: average >= 4.5 ? '#4caf50' : average >= 4 ? '#2196f3' : average >= 3.5 ? '#ff9800' : '#f44336'}}>
                          {average}
                        </div>
                      </div>
                    </div>
                    <div className="chart-container">
                      {[5, 4, 3, 2].map(grade => {
                        const count = stats[grade];
                        // Используем масштабирование с минимальной высотой в пикселях
                        const containerHeight = 250; // должна соответствовать CSS
                        const minHeightPx = 80; // минимальная высота для ненулевых значений
                        const maxHeightPx = containerHeight - 20; // оставляем отступ

                        let heightPx;
                        if (count === 0) {
                          heightPx = 0;
                        } else if (count === maxCount) {
                          heightPx = maxHeightPx;
                        } else {
                          const ratio = count / maxCount;
                          heightPx = minHeightPx + (maxHeightPx - minHeightPx) * ratio;
                        }

                        const gradeColors = {
                          5: '#4caf50',
                          4: '#2196f3',
                          3: '#ff9800',
                          2: '#f44336'
                        };
                        return (
                          <div key={grade} className="chart-bar">
                            <div className="bar-value">{count}</div>
                            <div className="bar-column" style={{height: `${heightPx}px`, backgroundColor: gradeColors[grade]}}></div>
                            <div className="bar-label">Оценка {grade}</div>
                          </div>
                        );
                      })}
                    </div>
                  </React.Fragment>
                )}
              </div>
            );
          })()}

                    {/* ==== Боевой пропуск ==== */}
          {(() => {
            const progress = getCurrentLevelProgress();
            return (
              <div className="card battle-pass">
                <h3 style={{ marginTop: 0 }}>🏆 Боевой пропуск сезона {battlePass.season}</h3>
                <p className="muted">«{battlePass.seasonName}»</p>

                <div className="xp-section">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Уровень: {battlePass.level} / {battlePass.maxLevel}</div>
                    <div style={{ fontWeight: 600, color: "#2196f3" }}>XP: {progress.current} / {progress.needed}</div>
                  </div>
                  <div className="progress-bar large">
                    <div className="progress-fill" style={{ width: `${progress.percentage}%` }}></div>
                  </div>
                </div>

                <h4 style={{ marginTop: "16px" }}>🎯 Задания</h4>
                {battlePass.tasks.length === 0 ? (
                  <p className="muted">Задания пока не добавлены. Администратор может добавить их через админ-панель.</p>
                ) : (
                  <ul className="bp-tasks">
                    {battlePass.tasks.map(task => {
                      const isCompleted = battlePass.completedTasks.includes(task.id);
                      return (
                        <li key={task.id} className={isCompleted ? "done" : ""}>
                          {isCompleted ? "✅" : "🔲"} {task.name} — <b>+{task.xp} XP</b>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <h4 style={{ marginTop: "16px" }}>🎁 Награды</h4>
                {battlePass.rewards.length === 0 ? (
                  <p className="muted">Награды пока не добавлены. Администратор может добавить их через админ-панель.</p>
                ) : (
                  <div className="rewards-grid">
                    {battlePass.rewards.map(reward => {
                      const isUnlocked = battlePass.level >= reward.level;
                      const isClaimed = battlePass.claimedRewards.includes(reward.id);
                      const canClaim = isUnlocked && !isClaimed;

                      return (
                        <div
                          key={reward.id}
                          className={`reward ${isUnlocked ? (isClaimed ? "claimed" : "unlocked") : "locked"}`}
                          onClick={() => canClaim && claimReward(reward.id)}
                          style={{ cursor: canClaim ? 'pointer' : 'default' }}
                          title={canClaim ? 'Нажмите чтобы получить награду' : isClaimed ? 'Награда получена' : `Откроется на уровне ${reward.level}`}
                        >
                          <div className="lvl">Ур.{reward.level}</div>
                          <div className="val">{reward.text}</div>
                          {isClaimed && <div className="claimed-badge">✅</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="card history">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
              <h3 style={{margin: 0}}>История</h3>
              {history.length > 0 && (
                <span className="muted" style={{fontSize: '13px'}}>
                  {showAllHistory ? `Всего: ${history.length}` : `Последние 5 дней`}
                </span>
              )}
            </div>
            {history.length===0 && <p className="muted">Пока нет оценок.</p>}
            {(() => {
              const filteredHistory = getFilteredHistory();
              const hasMore = !showAllHistory && history.length > filteredHistory.length;

              return (
                <React.Fragment>
                  {filteredHistory.map((h,i)=>{
                    // Находим реальный индекс в полной истории для удаления
                    const realIndex = history.findIndex(entry => entry === h);
                    return (
                      <div key={realIndex} className="entry">
                        <div>
                          <div><b>{h.date}</b> — {h.subject}: <b className={h.reward>=0?"":"negative"}>{h.grade}</b></div>
                          {h.bonus && <div className="bonus">{h.bonus}</div>}
                        </div>
                        <div className="row" style={{alignItems:'center'}}>
                          <div style={{minWidth:'90px', textAlign:'right', fontWeight:700}}>
                            {h.reward>=0?`+${h.reward}`:`${h.reward}`} ₽
                          </div>
                          <button className="text-btn" title="Удалить" onClick={()=>deleteEntry(realIndex)}>
                            <span className="material-icons">delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {history.length > 0 && (hasMore || showAllHistory) && (
                    <div style={{textAlign: 'center', marginTop: '16px'}}>
                      <button
                        className="text-btn"
                        onClick={() => setShowAllHistory(!showAllHistory)}
                        style={{fontSize: '14px'}}
                      >
                        {showAllHistory ? (
                          <React.Fragment>
                            <span className="material-icons" style={{fontSize: '18px', verticalAlign: 'middle'}}>expand_less</span>
                            Показать только последние 5 дней
                          </React.Fragment>
                        ) : (
                          <React.Fragment>
                            <span className="material-icons" style={{fontSize: '18px', verticalAlign: 'middle'}}>expand_more</span>
                            Показать всю историю ({history.length - filteredHistory.length} скрыто)
                          </React.Fragment>
                        )}
                      </button>
                    </div>
                  )}
                </React.Fragment>
              );
            })()}
          </div>

{/* ==== Админка боевого пропуска ==== */}
          {showBPAdmin && adminAccess && (
            <div className="card battle-pass-admin">
              <button className="close-admin-btn" title="Закрыть"
                    onClick={() => setShowBPAdmin(false)}>
                <span className="material-icons">close</span>
              </button>
              <h3>⚙️ Администрирование боевого пропуска</h3>

              <div className="section">
                <h4>📝 Название сезона</h4>
                <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                  <input
                    type="text"
                    value={battlePass.seasonName}
                    onChange={(e) => {
                      setBattlePass(prev => ({...prev, seasonName: e.target.value}));
                      setBpUnsavedChanges(true);
                    }}
                    placeholder="Например: Осенний апгрейд знаний"
                    style={{flex: 1}}
                  />
                  <span className="muted" style={{fontSize: '13px'}}>Сезон #{battlePass.season}</span>
                </div>
              </div>

              <div className="section">
                <h4>🎯 Задания</h4>
                <ul className="admin-list">
                  {battlePass.tasks.length === 0 ? (
                    <li style={{color: '#999'}}>Заданий пока нет</li>
                  ) : (
                    battlePass.tasks.map(task => (
                      <li key={task.id}>
                        {task.name} — <b>+{task.xp} XP</b>
                        <button className="text-btn" onClick={() => deleteTask(task.id)} style={{marginLeft: '8px'}}>
                          <span className="material-icons" style={{fontSize: '16px'}}>delete</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="row" style={{gap: '8px', flexWrap: 'wrap'}}>
                  <input
                    type="text"
                    placeholder="Название задания"
                    value={newTaskName}
                    onChange={e => setNewTaskName(e.target.value)}
                    style={{flex: '1 1 200px'}}
                  />
                  <select
                    value={newTaskType}
                    onChange={e => setNewTaskType(e.target.value)}
                    style={{width: '150px'}}
                  >
                    <option value="streak_fives">Серия пятёрок</option>
                    <option value="total_grades_week">Оценок за неделю</option>
                    <option value="average_score">Средний балл</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Цель"
                    value={newTaskTarget}
                    onChange={e => setNewTaskTarget(e.target.value)}
                    style={{width: '80px'}}
                    title="Например: 3 для '3 пятёрки подряд', 10 для '10 оценок', 4.5 для среднего балла"
                  />
                  <input
                    type="number"
                    placeholder="XP"
                    value={newTaskXP}
                    onChange={e => setNewTaskXP(e.target.value)}
                    style={{width: '80px'}}
                  />
                  <button onClick={addTask}>Добавить</button>
                </div>
              </div>

              <div className="section">
                <h4>🎁 Награды</h4>
                <ul className="admin-list">
                  {battlePass.rewards.length === 0 ? (
                    <li style={{color: '#999'}}>Наград пока нет</li>
                  ) : (
                    battlePass.rewards.map(reward => (
                      <li key={reward.id}>
                        Уровень {reward.level} — {reward.text}
                        {reward.type === 'money' && reward.amount && ` (${reward.amount}₽)`}
                        <button className="text-btn" onClick={() => deleteReward(reward.id)} style={{marginLeft: '8px'}}>
                          <span className="material-icons" style={{fontSize: '16px'}}>delete</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="row" style={{gap: '8px', flexWrap: 'wrap'}}>
                  <input
                    type="number"
                    placeholder="Уровень"
                    value={newRewardLevel}
                    onChange={e => setNewRewardLevel(e.target.value)}
                    style={{width: '80px'}}
                  />
                  <input
                    type="text"
                    placeholder="Описание награды"
                    value={newRewardText}
                    onChange={e => setNewRewardText(e.target.value)}
                    style={{flex: '1 1 150px'}}
                  />
                  <select
                    value={newRewardType}
                    onChange={e => setNewRewardType(e.target.value)}
                    style={{width: '120px'}}
                  >
                    <option value="other">Не деньги</option>
                    <option value="money">Деньги</option>
                  </select>
                  {newRewardType === 'money' && (
                    <input
                      type="number"
                      placeholder="Сумма ₽"
                      value={newRewardAmount}
                      onChange={e => setNewRewardAmount(e.target.value)}
                      style={{width: '100px'}}
                    />
                  )}
                  <button onClick={addReward}>Добавить</button>
                </div>
              </div>

              <div className="section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: "20px", gap: '12px' }}>
                <button
                  onClick={saveBattlePass}
                  style={{
                    background: bpUnsavedChanges ? '#2196f3' : '#4caf50',
                    flex: '1',
                    position: 'relative'
                  }}
                >
                  {bpUnsavedChanges ? (
                    <React.Fragment>
                      <span className="material-icons" style={{fontSize: '16px', verticalAlign: 'middle', marginRight: '4px'}}>save</span>
                      Сохранить изменения ⚠️
                    </React.Fragment>
                  ) : (
                    <React.Fragment>
                      <span className="material-icons" style={{fontSize: '16px', verticalAlign: 'middle', marginRight: '4px'}}>check_circle</span>
                      Сохранено
                    </React.Fragment>
                  )}
                </button>
                <button onClick={resetSeason} className="danger-btn">Сбросить сезон</button>
              </div>
            </div>
          )}

              
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
