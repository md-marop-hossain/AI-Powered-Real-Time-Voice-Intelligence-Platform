import { Link } from "react-router-dom";
import { Eyebrow } from "@/components/editorial/Eyebrow";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <Eyebrow>404</Eyebrow>
      <h1 className="mt-6 text-display text-ink">
        This page is somewhere else.
      </h1>
      <Link to="/dashboard" className="editorial-link mt-12 text-ink">
        Back to your sessions <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
