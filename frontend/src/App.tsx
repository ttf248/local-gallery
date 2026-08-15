import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Home from './routes/Home'
import Recents from './routes/Recents'
import Favorites from './routes/Favorites'
import Album from './routes/Album'
import Author from './routes/Author'
import Viewer from './routes/Viewer'
import Settings from './routes/Settings'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/recents" element={<Recents />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/albums/*" element={<Album />} />
        <Route path="/authors/*" element={<Author />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      {/* 查看器独立布局（T11 完善） */}
      <Route path="/viewer/*" element={<Viewer />} />
    </Routes>
  )
}
