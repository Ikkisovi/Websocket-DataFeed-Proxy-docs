import React from "react";
import { createRoot } from "react-dom/client";
import { UpdatesPage } from "../public/updates-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<UpdatesPage />);
