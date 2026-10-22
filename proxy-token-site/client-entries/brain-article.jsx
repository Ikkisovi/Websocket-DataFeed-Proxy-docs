import React from "react";
import { createRoot } from "react-dom/client";
import { BrainArticlePage } from "../public/reports/brain-article.jsx";
window.React = React;
createRoot(document.getElementById("root")).render(<BrainArticlePage />);
