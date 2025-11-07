import React from 'react'
import ErrorBoundary from './components/ErrorBoundary'

const SimpleApp: React.FC = () => {
  return (
    <ErrorBoundary>
      <div style={{
        height: '100vh',
        backgroundColor: '#F8F9FA',
        color: '#2C3E50',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        fontSize: '16px'
      }}>
        <h1 style={{ fontSize: '32px', fontWeight: 'bold' }}>📚 漫画阅读器</h1>
        <p>简单测试版本 - React 正常渲染</p>

        {/* 测试基本 UI 组件 */}
        <div style={{
          marginTop: '40px',
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          width: '400px',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>✅ 状态检查</h2>
          <div style={{ fontSize: '14px', color: '#6C757D' }}>
            <p>✓ React 渲染正常</p>
            <p>✓ Tailwind CSS 加载</p>
            <p>✓ 错误边界已启用</p>
            <p>✓ 构建成功</p>
          </div>
        </div>

        <div style={{
          marginTop: '30px',
          padding: '15px',
          backgroundColor: '#E8F4FD',
          borderRadius: '6px',
          border: '1px solid #4A90E2',
          fontSize: '14px',
          maxWidth: '600px'
        }}>
          <p><strong>如果看到这行文字，说明白屏问题已修复！</strong></p>
          <p style={{ marginTop: '10px' }}>时间: {new Date().toLocaleString()}</p>
        </div>
      </div>
    </ErrorBoundary>
  )
}

export default SimpleApp
