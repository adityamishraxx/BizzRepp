import React from 'react';
import Sidebar from './Sidebar';

export default function Layout({ children }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
