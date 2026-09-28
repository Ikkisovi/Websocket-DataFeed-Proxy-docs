import React from "react";
import { createRoot } from "react-dom/client";
import { ResearchDataPage } from "../public/research-data-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<ResearchDataPage />);
