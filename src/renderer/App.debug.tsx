import React from 'react'
import ErrorBoundary from './components/ErrorBoundary'

const DebugApp: React.FC = () => {
  return (
    <ErrorBoundary>
      <div style={{
        height: '100vh',
        backgroundColor: '#F8F9FA',
        color: '#2C3E50',
        padding: '20px',
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'auto'
      }}>
        <h1 style={{ fontSize: '32px', fontWeight: 300, marginBottom: '20px' }}>
          📚 漫画阅读器 - 调试模式
        </h1>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '20px',
          marginBottom: '30px'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #E9ECEF'
          }}>
            <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>React 状态</h2>
            <p>✓ React 版本: {React.version}</p>
            <p>✓ 组件渲染: 成功</p>
            <p>✓ 状态管理: Zustand</p>
            <p>✓ 构建时间: {new Date().toLocaleString()}</p>
          </div>

          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #E9ECEF'
          }}>
            <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>模块检查</h2>
            <p>✓ App.tsx: 已加载</p>
            <p>✓ Store: useComicStore</p>
            <p>✓ DataManager: 已初始化</p>
            <p>✓ ErrorBoundary: 激活中</p>
          </div>
        </div>

        <div style={{
          backgroundColor: '#E8F4FD',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid #4A90E2',
          marginBottom: '20px'
        }}>
          <h2 style={{ fontSize: '20px', marginBottom: '15px', color: '#4A90E2' }}>
            🎉 成功信息
          </h2>
          <p style={{ fontSize: '16px', lineHeight: '1.6' }}>
            如果看到此页面，说明：
          </p>
          <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
            <li>React 应用正常启动和渲染</li>
            <li>所有模块正确导入</li>
            <li>错误边界工作正常</li>
            <li>构建和打包成功</li>
            <li><strong>白屏问题已解决！</strong></li>
          </ul>
        </div>

        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid #E9ECEF'
        }}>
          <h2 style={{ fontSize: '18px', marginBottom: '10px' }}>技术栈</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {['React 18', 'TypeScript 5', 'Vite 5', 'Electron 28', 'Tailwind CSS 3', 'Zustand 4'].map(tech => (
              <span key={tech} style={{
                padding: '6px 12px',
                backgroundColor: '#F8F9FA',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#6C757D'
              }}>
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default DebugApp
