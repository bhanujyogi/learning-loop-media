import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setV)
      .catch(() => undefined);
    const s = AccessibilityInfo.addEventListener('reduceMotionChanged', setV);
    return () => s.remove();
  }, []);
  return v;
}
