import React from "react";
import { createRoot } from "react-dom/client";
import { CheckoutPage } from "../public/checkout-page.jsx";

window.React = React;
createRoot(document.getElementById("root")).render(<CheckoutPage />);
