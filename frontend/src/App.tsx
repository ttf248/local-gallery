import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './routes/Home'
import Recents from './routes/Recents'
import Favorites from './routes/Favorites'
import Album from './routes/Album'
import Viewer from './routes/Viewer'
import Settings from './routes/Settings'

// T8：路由占位。T9+ 加上 AppShell 包裹。
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/recents" element={<Recents />} />
      <Route path="/favorites" element={<Favorites />} />
      <Route path="/albums/*" element={<Album />} />
      <Route path="/viewer/*" element={<Viewer />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
