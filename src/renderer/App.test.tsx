import React from 'react'

const TestApp: React.FC = () => {
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
      gap: '20px'
    }}>
      <h1>🎉 React 渲染成功！</h1>
      <p>如果看到这个，说明白屏问题已解决</p>
      <p>时间: {new Date().toLocaleString()}</p>
    </div>
  )
}

export default TestApp
