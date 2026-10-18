// Запуск приложения на API (выбирает src/main.js по DATA_BACKEND=api)
import React from "react";
import ReactDOM from "react-dom/client";
import { createFirebaseAuth } from "./firebase.js";
import { createApi } from "./api.js";
import { DialogProvider } from "./dialogs.jsx";
import { App } from "./App.jsx";

export function mount(env) {
  const auth = createFirebaseAuth(env);
  const api = createApi({ getIdToken: () => auth.getIdToken() });
  ReactDOM.createRoot(document.getElementById("root")).render(
    <DialogProvider>
      <App auth={auth} api={api} />
    </DialogProvider>
  );
}
