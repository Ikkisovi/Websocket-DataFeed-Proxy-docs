import React from "react";
import { createRoot } from "react-dom/client";
import { ReportsPage } from "../public/reports/reports-page.jsx";
window.React = React;
createRoot(document.getElementById("root")).render(<ReportsPage />);
