import React from "react";
import { createRoot } from "react-dom/client";
import { RegisterPage } from "../public/register-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<RegisterPage />);
