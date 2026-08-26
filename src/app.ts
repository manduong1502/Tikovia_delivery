// Tailwind stylesheet
import "@/css/tailwind.scss";
// Your stylesheet
import "@/css/app.scss";

// React core
import React from "react";
import { createRoot } from "react-dom/client";

// Mount the app
import Layout from "./components/Layout"; 

const root = createRoot(document.getElementById("app")!);
root.render(React.createElement(Layout));
