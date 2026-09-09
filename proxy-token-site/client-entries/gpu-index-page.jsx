import React from "react";
import { createRoot } from "react-dom/client";
import { GpuIndexPage } from "../public/gpu-index-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<GpuIndexPage />);
