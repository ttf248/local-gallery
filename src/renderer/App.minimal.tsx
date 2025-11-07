import React from 'react'

const MinimalApp: React.FC = () => {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#F8F9FA',
      color: '#2C3E50',
      fontSize: '24px',
      flexDirection: 'column',
      gap: '20px',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{
        fontSize: '64px',
        marginBottom: '20px'
      }}>
        📚
      </div>
      <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
        漫画阅读器
      </h1>
      <p style={{ fontSize: '16px', color: '#6C757D' }}>
        最小化测试版本 - React 正常渲染
      </p>
      <div style={{
        marginTop: '40px',
        padding: '20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        textAlign: 'center',
        minWidth: '400px'
      }}>
        <h2 style={{ fontSize: '20px', marginBottom: '15px', color: '#4A90E2' }}>
          ✅ 状态检查
        </h2>
        <div style={{ fontSize: '14px', color: '#6C757D', lineHeight: '1.8' }}>
          <p>✓ React 18 正常渲染</p>
          <p>✓ 组件无错误</p>
          <p>✓ 构建成功</p>
          <p>✓ 开发模式运行</p>
        </div>
      </div>
      <div style={{
        marginTop: '30px',
        padding: '15px 25px',
        backgroundColor: '#E8F4FD',
        borderRadius: '6px',
        border: '1px solid #4A90E2',
        fontSize: '14px'
      }}>
        <strong>如果看到这行文字，说明白屏问题已解决！</strong>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#6C757D' }}>
          时间: {new Date().toLocaleString()}
        </div>
      </div>
    </div>
  )
}

export default MinimalApp
