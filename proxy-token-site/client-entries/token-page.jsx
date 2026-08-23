import React from "react";
import { createRoot } from "react-dom/client";
import { TokenPage } from "../public/token-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<TokenPage />);
