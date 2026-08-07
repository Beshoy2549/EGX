import { createRouter, createWebHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import ScalpView from "./views/ScalpView.vue";
import StockDetailView from "./views/StockDetailView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/scalp", name: "scalp", component: ScalpView },
    { path: "/stock/:ticker", name: "stock", component: StockDetailView, props: true },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});
