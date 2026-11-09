import { useEffect, useState } from 'react';
export const welcomeMessages = [
  'A little reading time, just for you.',
  'Your next chapter is waiting.',
  'Settle in. There’s a story to enjoy.',
  'Make a little room for manga today.',
  'One page can lead somewhere wonderful.',
  'Welcome back to your reading corner.',
  'Take a breath and turn a page.',
  'A familiar favorite or a fresh beginning?',
  'Find your place and get comfortable.',
  'A good story makes a lovely little break.',
  'Your shelf has something for today.',
  'Leave a little time for the next chapter.',
  'No rush. Read at your own pace.',
  'Back for another adventure?',
  'Let the rest of the day wait a page.',
  'There’s always room for one more story.',
  'Pick a title and make yourself at home.',
  'A quiet moment looks good on you.',
  'Time to see what happens next.',
  'Here’s to a few well-spent pages.',
] as const;
export function welcomeForDate(date: Date) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return welcomeMessages[
    ((day % welcomeMessages.length) + welcomeMessages.length) % welcomeMessages.length
  ];
}
export default function DailyWelcome() {
  const [message, setMessage] = useState(() => welcomeForDate(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = new Date();
      setMessage(welcomeForDate(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(
        update,
        Math.max(1000, Math.min(midnight.getTime() - now.getTime() + 50, 60000)),
      );
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return <p>{message}</p>;
}
