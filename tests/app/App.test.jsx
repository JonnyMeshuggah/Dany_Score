// @vitest-environment jsdom
// Экраны приложения на API: поддельные Firebase Auth и API, настоящие компоненты и диалоги.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { App } from "../../src/app/App.jsx";
import { DialogProvider } from "../../src/app/dialogs.jsx";
import { todayISO } from "../../src/domain/dates.js";

const USER = { uid: "u1", email: "kid@example.com" };

function makeState(over = {}) {
  return {
    balance: 1000,
    history: [
      { id: 2, kind: "grade", date: "17.10.2026", subject: "Алгебра", grade: 5, reward: 250, bonus: "" },
      { id: 1, kind: "cashout", date: "16.10.2026", subject: "💸 Вывод средств", grade: "—", reward: -100, bonus: "Частичный вывод" }
    ],
    battlePass: {
      season: 1, seasonName: "Зима", maxLevel: 10, xpPerLevel: 200, xp: 250, level: 1,
      tasks: [{ id: 7, name: "3 пятёрки", xp: 150, type: "streak_fives", target: 3 }],
      rewards: [{ id: 9, level: 1, text: "Кино", type: "other" }, { id: 10, level: 5, text: "Велосипед", type: "other" }],
      completedTasks: [7], claimedRewards: [], badges: [1]
    },
    ...over
  };
}

function fakeAuth(user = USER) {
  let listener;
  return {
    onChange: (cb) => { listener = cb; cb(user); return () => {}; },
    signIn: vi.fn(async () => { const e = new Error("Firebase: Error"); e.code = "auth/invalid-credential"; throw e; }),
    register: vi.fn(),
    signOut: vi.fn(async () => listener(null)),
    getIdToken: async () => "t",
    emit: (u) => listener(u)
  };
}

function fakeApi(state = makeState()) {
  let admin = false;
  const withState = (extra = {}, next = state) => async () => ({ ...extra, state: next });
  return {
    get isAdmin() { return admin; },
    lockAdmin: vi.fn(() => { admin = false; }),
    unlockAdmin: vi.fn(async (pin) => {
      if (pin !== "123456") throw Object.assign(new Error("Неверный код доступа"), { code: "wrong_pin" });
      admin = true;
      return { token: "adm" };
    }),
    getState: vi.fn(async () => state),
    addGrade: vi.fn(withState({ entry: { subject: "Алгебра", grade: 5, reward: 250, bonus: "" }, completedTasks: [], levelUp: false },
      makeState({ balance: 1250 }))),
    deleteEntry: vi.fn(withState({ deleted: 2 }, makeState({ balance: 750 }))),
    cashOut: vi.fn(withState({ entry: {} }, makeState({ balance: 900 }))),
    claimReward: vi.fn(withState({ claimed: 9 })),
    exportCSV: vi.fn(async () => "csv"),
    adminBonus: vi.fn(withState({ entry: {} }, makeState({ balance: 1500 }))),
    importHistory: vi.fn(withState({ imported: 3 })),
    updateSeason: vi.fn(withState()),
    resetSeason: vi.fn(withState()),
    addTask: vi.fn(withState({ id: 8 })),
    deleteTask: vi.fn(withState()),
    addReward: vi.fn(withState({ id: 11 })),
    deleteReward: vi.fn(withState())
  };
}

function renderApp({ auth = fakeAuth(), api = fakeApi() } = {}) {
  render(<DialogProvider><App auth={auth} api={api} /></DialogProvider>);
  return { auth, api };
}

const dialog = () => screen.getByRole("dialog");
const confirmDialog = () => fireEvent.click(within(dialog()).getByRole("button", { name: /^(OK|Выдать|Удалить|Начислить|Заменить|Сбросить|Открыть)$/ }));
const toastText = () => screen.getByRole("status").textContent;

beforeEach(() => {
  // Боковая панель — статическая разметка index.html
  document.body.innerHTML = `<div id="sidebar"><button id="closeSidebar"></button><button id="exportBtn"></button>
    <button id="battlePassAdmin"></button><input type="file" id="importFile"></div>`;
});
afterEach(cleanup);

describe("вход и загрузка", () => {
  it("без входа — форма; ошибка Firebase по-русски", async () => {
    const auth = fakeAuth(null);
    renderApp({ auth });
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Неверный email или пароль");
    expect(auth.signIn).toHaveBeenCalledWith("a@b.c", "x");
  });

  it("после входа — состояние с сервера", async () => {
    renderApp();
    expect(await screen.findByText("Баланс: 1000 ₽")).toBeTruthy();
    expect(screen.getByText("kid@example.com")).toBeTruthy();
    expect(screen.getByText("Уровень: 1 / 10")).toBeTruthy();
    expect(screen.getByText(/3 пятёрки/).closest("li").className).toBe("done");
    expect(screen.getByAltText("Бейдж 1").getAttribute("src")).toBe("badges/1.png");
    expect(screen.getByAltText("Бейдж 2 (не получен)").getAttribute("src")).toBe("badges/2G.png");
  });

  it("ошибка загрузки — сообщение и «Повторить»", async () => {
    const api = fakeApi();
    api.getState.mockRejectedValueOnce(new Error("Нет связи с сервером"));
    renderApp({ api });
    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Баланс: 1000 ₽")).toBeTruthy();
    expect(api.getState).toHaveBeenCalledTimes(2);
  });

  it("выход — снова форма входа, админка закрыта", async () => {
    const { api } = renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Выйти" }));
    expect(await screen.findByRole("button", { name: "Войти" })).toBeTruthy();
    expect(api.lockAdmin).toHaveBeenCalled();
  });
});

describe("смена пользователя и сессия", () => {
  it("поздний ответ прежнего пользователя не попадает на экран нового", async () => {
    const api = fakeApi();
    let releaseOld;
    api.getState
      .mockImplementationOnce(() => new Promise(r => { releaseOld = () => r(makeState({ balance: 111 })); }))
      .mockImplementationOnce(async () => makeState({ balance: 222 }));
    const auth = fakeAuth();
    renderApp({ auth, api });
    await act(async () => auth.emit({ uid: "u2", email: "other@example.com" }));
    expect(await screen.findByText("Баланс: 222 ₽")).toBeTruthy();
    await act(async () => releaseOld());
    expect(screen.getByText("Баланс: 222 ₽")).toBeTruthy();
  });

  it("начальная загрузка, пришедшая после мутации, не откатывает экран", async () => {
    const api = fakeApi();
    let releaseLoad;
    api.getState.mockImplementationOnce(() => new Promise(r => { releaseLoad = () => r(makeState({ balance: 1000 })); }));
    api.importHistory.mockResolvedValueOnce({ imported: 1, state: makeState({ balance: 777 }) });
    renderApp({ api });
    // Импорт из боковой панели, пока первая загрузка ещё идёт
    fireEvent.change(document.getElementById("importFile"), { target: { files: [new File(["x"], "h.csv")] } });
    fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("Введите PIN администратора"), { target: { value: "123456" } });
    confirmDialog();
    await screen.findByText("Загрузить историю из файла и заменить текущую?");
    confirmDialog();
    expect(await screen.findByText("Баланс: 777 ₽")).toBeTruthy();
    await act(async () => releaseLoad());
    expect(screen.getByText("Баланс: 777 ₽")).toBeTruthy();
  });

  it("смена аккаунта при открытом подтверждении вывода — окно закрыто, вывода нет", async () => {
    const auth = fakeAuth();
    const { api } = renderApp({ auth });
    fireEvent.change(await screen.findByLabelText("Сумма вывода"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Вывести/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => auth.emit({ uid: "u2", email: "other@example.com" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText("Баланс: 1000 ₽");
    expect(api.cashOut).not.toHaveBeenCalled();
  });

  it("смена аккаунта, пока читается файл импорта, — файл прежнего пользователя не загружается", async () => {
    // FileReader, который дочитывает по команде теста
    const RealReader = window.FileReader;
    let finishRead;
    window.FileReader = class {
      readAsText() { finishRead = () => { this.result = "x"; this.onload(); }; }
    };
    try {
      const auth = fakeAuth();
      const { api } = renderApp({ auth });
      await screen.findByText("Баланс: 1000 ₽");
      fireEvent.change(document.getElementById("importFile"), { target: { files: [new File(["x"], "h.csv")] } });
      fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("Введите PIN администратора"), { target: { value: "123456" } });
      await act(async () => confirmDialog());
      await waitFor(() => expect(finishRead).toBeTypeOf("function"));
      await act(async () => auth.emit({ uid: "u2", email: "other@example.com" }));
      await act(async () => finishRead());
      expect(screen.queryByText("Загрузить историю из файла и заменить текущую?")).toBeNull();
      expect(api.importHistory).not.toHaveBeenCalled();
    } finally {
      window.FileReader = RealReader;
    }
  });

  it("повторное уведомление о том же пользователе не сбрасывает экран", async () => {
    const auth = fakeAuth();
    const { api } = renderApp({ auth });
    await screen.findByText("Баланс: 1000 ₽");
    await act(async () => auth.emit({ ...USER }));
    expect(screen.getByText("Баланс: 1000 ₽")).toBeTruthy();
    expect(api.getState).toHaveBeenCalledTimes(1);
  });

  it("сервер не принял вход (401) — выход", async () => {
    const api = fakeApi();
    api.cashOut.mockRejectedValueOnce(Object.assign(new Error("Сессия истекла — войдите снова"), { code: "unauthorized" }));
    const { auth } = renderApp({ api });
    fireEvent.change(await screen.findByLabelText("Сумма вывода"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Вывести/ }));
    confirmDialog();
    expect(await screen.findByRole("button", { name: "Войти" })).toBeTruthy();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("второе окно поверх первого закрывает первое отказом", async () => {
    const { api } = renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Удалить: 17.10.2026, Алгебра" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить: 16.10.2026, 💸 Вывод средств" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    confirmDialog();
    await waitFor(() => expect(api.deleteEntry).toHaveBeenCalledTimes(1));
    expect(api.deleteEntry).toHaveBeenCalledWith(1);
  });
});

describe("оценки и история", () => {
  it("добавление: дата ISO, предмет, оценка; баланс из ответа", async () => {
    const { api } = renderApp();
    await screen.findByText("Баланс: 1000 ₽");
    fireEvent.change(screen.getByLabelText("Оценка"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    expect(await screen.findByText("Баланс: 1250 ₽")).toBeTruthy();
    expect(api.addGrade).toHaveBeenCalledWith({ date: todayISO(), subject: "Алгебра", grade: 4 });
    expect(toastText()).toContain("+250 ₽");
  });

  it("Пятик реагирует на добавленную оценку, приветствие её не перебивает", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Добавить/ }));
    const bubble = () => document.querySelector(".buddy-say").textContent;
    await waitFor(() => expect(bubble()).toMatch(/Пятик.*(\+250 ₽|Алгебра|Пятёрка)/));
    const reaction = bubble();
    await act(() => new Promise(r => setTimeout(r, 1300)));
    expect(bubble()).toBe(reaction);
  });

  it("двойной клик — один запрос", async () => {
    const api = fakeApi();
    let release;
    api.addGrade.mockImplementation(() => new Promise(r => { release = () => r({ entry: { subject: "А", grade: 5, reward: 250 }, completedTasks: [], levelUp: false, state: makeState() }); }));
    renderApp({ api });
    const btn = await screen.findByRole("button", { name: /Добавить/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    await act(async () => release());
    expect(api.addGrade).toHaveBeenCalledTimes(1);
  });

  it("новый уровень и задания — уведомления", async () => {
    const api = fakeApi();
    api.addGrade.mockResolvedValueOnce({ entry: { subject: "А", grade: 5, reward: 250, bonus: "" }, completedTasks: [7], levelUp: true, state: makeState() });
    renderApp({ api });
    fireEvent.click(await screen.findByRole("button", { name: /Добавить/ }));
    await waitFor(() => expect(toastText()).toContain("Новый уровень 1"));
    expect(toastText()).toContain("Выполнено заданий: 1");
  });

  it("удаление — только после подтверждения, по id записи", async () => {
    const { api } = renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Удалить: 17.10.2026, Алгебра" }));
    expect(within(dialog()).getByText(/Удалить запись «Алгебра» от 17\.10\.2026/)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Отмена" }));
    expect(api.deleteEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить: 17.10.2026, Алгебра" }));
    confirmDialog();
    expect(await screen.findByText("Баланс: 750 ₽")).toBeTruthy();
    expect(api.deleteEntry).toHaveBeenCalledWith(2);
  });
});

describe("деньги", () => {
  async function cashOut(value) {
    fireEvent.change(await screen.findByLabelText("Сумма вывода"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /Вывести/ }));
  }

  it("вывод: подтверждение, запрос, поле очищается", async () => {
    const { api } = renderApp();
    await cashOut("100");
    expect(within(dialog()).getByText("Выдать 100 ₽ и уменьшить баланс?")).toBeTruthy();
    confirmDialog();
    expect(await screen.findByText("Баланс: 900 ₽")).toBeTruthy();
    expect(api.cashOut).toHaveBeenCalledWith(100);
    expect(screen.getByLabelText("Сумма вывода").value).toBe("");
  });

  it("больше баланса, ноль, дробь — без запроса", async () => {
    const { api } = renderApp();
    for (const v of ["5000", "0", "10.5"]) {
      await cashOut(v);
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    expect(api.cashOut).not.toHaveBeenCalled();
    expect(toastText()).toContain("Сумма больше баланса");
  });

  it("ошибка сервера — уведомление, баланс прежний", async () => {
    const api = fakeApi();
    api.cashOut.mockRejectedValueOnce(Object.assign(new Error("Сумма больше баланса"), { code: "conflict" }));
    renderApp({ api });
    await cashOut("100");
    confirmDialog();
    await waitFor(() => expect(toastText()).toContain("Сумма больше баланса"));
    expect(screen.getByText("Баланс: 1000 ₽")).toBeTruthy();
  });

  it("награда: доступная получается, закрытая — нет", async () => {
    const { api } = renderApp();
    fireEvent.click(await screen.findByText("Велосипед"));
    expect(api.claimReward).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Кино"));
    await waitFor(() => expect(api.claimReward).toHaveBeenCalledWith(9));
    expect(toastText()).toContain("Награда «Кино» получена");
  });
});

describe("админка и боковая панель", () => {
  async function openAdmin(pin = "123456") {
    await screen.findByText("Баланс: 1000 ₽");
    fireEvent.click(document.getElementById("battlePassAdmin"));
    fireEvent.change(within(dialog()).getByLabelText("Введите PIN администратора"), { target: { value: pin } });
    confirmDialog();
  }

  it("PIN открывает админку; бонус — с подтверждением", async () => {
    const { api } = renderApp();
    await openAdmin();
    expect(await screen.findByText("⚙️ Администрирование боевого пропуска")).toBeTruthy();
    expect(api.unlockAdmin).toHaveBeenCalledWith("123456");

    fireEvent.change(screen.getByLabelText("Сумма бонуса"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Начислить" }));
    confirmDialog();
    expect(await screen.findByText("Баланс: 1500 ₽")).toBeTruthy();
    expect(api.adminBonus).toHaveBeenCalledWith(500);
  });

  it("неверный PIN — админка закрыта", async () => {
    renderApp();
    await openAdmin("1");
    await waitFor(() => expect(toastText()).toContain("Неверный код доступа"));
    expect(screen.queryByText("⚙️ Администрирование боевого пропуска")).toBeNull();
  });

  it("задание и награда уходят на сервер в формате API", async () => {
    const { api } = renderApp();
    await openAdmin();
    await screen.findByText("⚙️ Администрирование боевого пропуска");
    fireEvent.change(screen.getByLabelText("Название задания"), { target: { value: "10 оценок" } });
    fireEvent.change(screen.getByLabelText("Тип задания"), { target: { value: "total_grades_week" } });
    fireEvent.change(screen.getByLabelText("Цель задания"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("XP задания"), { target: { value: "120" } });
    fireEvent.click(within(screen.getByLabelText("Название задания").closest("form")).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.addTask).toHaveBeenCalledWith({ name: "10 оценок", type: "total_grades_week", target: 10, xp: 120 }));

    fireEvent.change(screen.getByLabelText("Уровень награды"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Описание награды"), { target: { value: "Деньги" } });
    fireEvent.change(screen.getByLabelText("Тип награды"), { target: { value: "money" } });
    fireEvent.change(screen.getByLabelText("Сумма награды"), { target: { value: "300" } });
    fireEvent.click(within(screen.getByLabelText("Описание награды").closest("form")).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.addReward).toHaveBeenCalledWith({ level: 2, text: "Деньги", type: "money", amount: 300 }));
  });

  it("истёкший токен админки — панель закрывается, просим PIN снова", async () => {
    const api = fakeApi();
    api.resetSeason.mockRejectedValueOnce(Object.assign(new Error("Админка закрыта — введите PIN ещё раз"), { code: "forbidden" }));
    renderApp({ api });
    await openAdmin();
    fireEvent.click(await screen.findByRole("button", { name: "Сбросить сезон" }));
    confirmDialog();
    await waitFor(() => expect(screen.queryByText("⚙️ Администрирование боевого пропуска")).toBeNull());
    expect(toastText()).toContain("введите PIN ещё раз");
    expect(api.lockAdmin).toHaveBeenCalled();
  });

  it("импорт CSV: PIN, подтверждение, текст файла уходит на сервер", async () => {
    const { api } = renderApp();
    await screen.findByText("Баланс: 1000 ₽");
    const file = new File(["Дата,Предмет\n"], "h.csv", { type: "text/csv" });
    fireEvent.change(document.getElementById("importFile"), { target: { files: [file] } });
    fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("Введите PIN администратора"), { target: { value: "123456" } });
    confirmDialog();
    expect(await screen.findByText("Загрузить историю из файла и заменить текущую?")).toBeTruthy();
    confirmDialog();
    await waitFor(() => expect(api.importHistory).toHaveBeenCalledWith("Дата,Предмет\n"));
    expect(toastText()).toContain("Загружено записей: 3");
  });

  it("экспорт CSV скачивает файл с сервера", async () => {
    const { api } = renderApp();
    await screen.findByText("Баланс: 1000 ₽");
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(document.getElementById("exportBtn"));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.exportCSV).toHaveBeenCalled();
    click.mockRestore();
  });
});
