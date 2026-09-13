import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { useRoute } from "./lib/router";
import CallPage from "./pages/CallPage";
import EvidencePage from "./pages/EvidencePage";
import GenomePage from "./pages/GenomePage";
import Landing from "./pages/Landing";
import RoomPage from "./pages/RoomPage";

function App() {
  const route = useRoute();
  const [root, id] = route.parts;
  if (root === "call" && id) return <CallPage sessionId={id} />;
  if (root === "room" && id) return <RoomPage sessionId={id} />;
  if (root === "evidence" && id) return <EvidencePage sessionId={id} />;
  if (root === "genome") return <GenomePage />;
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
