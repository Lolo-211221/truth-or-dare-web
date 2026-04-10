import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import HomePage from './pages/HomePage';
import LandingPage from './pages/LandingPage';
import RoomPage from './pages/RoomPage';

export default function App() {
  return (
    <div className="app-shell">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/play" element={<HomePage />} />
          <Route path="/room/:roomCode" element={<RoomPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
