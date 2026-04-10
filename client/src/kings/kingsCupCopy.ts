/** Display copy for standard Kings Cup style rules (drink responsibly). */
export function kingsCupRule(rank: string, isX: boolean): { emoji: string; title: string; rule: string } {
  if (isX || rank === 'X') {
    return {
      emoji: '☠️',
      title: 'The X Card',
      rule: 'FINISH YOUR DRINK. No exceptions. The deck warned you.',
    };
  }
  const R: Record<string, { emoji: string; title: string; rule: string }> = {
    A: {
      emoji: '🌊',
      title: 'Waterfall',
      rule: 'Everyone drinks in order — you can’t stop until the person before you stops.',
    },
    '2': {
      emoji: '👉',
      title: 'You',
      rule: 'Pick someone to drink.',
    },
    '3': {
      emoji: '🫵',
      title: 'Me',
      rule: 'You drink.',
    },
    '4': {
      emoji: '👠',
      title: 'Whores',
      rule: 'Anyone who identifies as a girl drinks.',
    },
    '5': {
      emoji: '🚗',
      title: 'Drive',
      rule: 'Tap through: thumbs up → vroom → skirt. Last or wrong tap drinks.',
    },
    '6': {
      emoji: '🍆',
      title: 'Dicks',
      rule: 'Anyone who identifies as a guy drinks.',
    },
    '7': {
      emoji: '🙏',
      title: 'Heaven',
      rule: 'Race to tap heaven — last one drinks.',
    },
    '8': {
      emoji: '🤝',
      title: 'Mate',
      rule: 'Pick a drinking buddy — you drink together when either is chosen.',
    },
    '9': {
      emoji: '🎤',
      title: 'Rhyme',
      rule: 'Say a word — go around rhyming. First to fail drinks.',
    },
    '10': {
      emoji: '📋',
      title: 'Categories',
      rule: 'Pick a category — go around. First to blank drinks.',
    },
    J: {
      emoji: '🤚',
      title: 'Never Have I Ever',
      rule: 'Quick NHIE round — losers drink.',
    },
    Q: {
      emoji: '👸',
      title: 'Question curse',
      rule: 'Pick someone: they cannot answer YOUR questions until the next Queen.',
    },
    K: {
      emoji: '👑',
      title: 'King',
      rule: 'Make a house rule until the next King is drawn.',
    },
  };
  return R[rank] ?? { emoji: '🃏', title: rank, rule: 'Follow the circle.' };
}
