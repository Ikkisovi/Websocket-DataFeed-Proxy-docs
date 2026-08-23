import React from "react";
import { createRoot } from "react-dom/client";
import { AccountPage } from "../public/account-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<AccountPage />);
