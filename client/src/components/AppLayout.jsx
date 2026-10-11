import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import Footer from './Footer.jsx';

export default function AppLayout({ title, subtitle, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="main-area">
        <Topbar title={title} subtitle={subtitle} onMenuClick={() => setMobileOpen(true)} />
        <div key={location.pathname} className="page-container fade-up">{children}</div>
        <Footer />
      </div>
    </div>
  );
}
