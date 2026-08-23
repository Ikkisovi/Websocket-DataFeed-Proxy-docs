import React from "react";
import { createRoot } from "react-dom/client";
import { DocsSite } from "../public/docs/docs-site.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<DocsSite />);
