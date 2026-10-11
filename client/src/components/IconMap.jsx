import {
  Calculator, FlaskConical, BookOpen, Globe2, Laptop, Atom, Dna, TrendingUp,
  BookMarked
} from 'lucide-react';

const MAP = { Calculator, FlaskConical, BookOpen, Globe2, Laptop, Atom, Dna, TrendingUp };

export default function SubjectIcon({ name, size = 20, color }) {
  const Icon = MAP[name] || BookMarked;
  return <Icon size={size} color={color} />;
}
