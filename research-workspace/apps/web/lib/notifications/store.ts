import { configureStore } from "@reduxjs/toolkit";
import notifications from "./slice";

export const makeStore = () => configureStore({ reducer: { notifications } });
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

/** One store per document. The server renders only the seed; the browser hydrates it from storage after mount. */
let singleton: AppStore | undefined;
export const getStore = (): AppStore => (singleton ??= makeStore());
