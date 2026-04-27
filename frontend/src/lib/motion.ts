export const easeEditorial = [0.22, 1, 0.36, 1] as const;

export const durations = {
  quick: 0.2,
  base: 0.4,
  slow: 0.7,
} as const;

export const fadeRise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: durations.base, ease: easeEditorial },
};

export const stagger = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: durations.base, ease: easeEditorial, delay },
});

export const staggerChildren = {
  animate: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};
