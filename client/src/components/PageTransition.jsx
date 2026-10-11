import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Lightweight fade+slide transition between routes. Re-triggers the
 * fade-up animation whenever the pathname changes, without pulling in
 * a full transition-group dependency.
 */
export default function PageTransition({ children }) {
  const location = useLocation();
  const [displayKey, setDisplayKey] = useState(location.pathname);

  useEffect(() => {
    setDisplayKey(location.pathname);
  }, [location.pathname]);

  return (
    <div key={displayKey} className="fade-up" style={{ width: '100%' }}>
      {children}
    </div>
  );
}
