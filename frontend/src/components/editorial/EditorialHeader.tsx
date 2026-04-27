import { Link, NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";
import { useAuthStore } from "@/store/auth";

const navLinks = [
  { to: "/upload", label: "Practice" },
  { to: "/dashboard", label: "History" },
  { to: "/account", label: "Account" },
];

export function EditorialHeader() {
  const navigate = useNavigate();
  const { user, clear } = useAuthStore();

  const handleSignOut = () => {
    clear();
    navigate("/login");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        "bg-canvas/85 backdrop-blur-[8px]",
        "border-b border-rule",
      )}
    >
      <div className="editorial-container flex h-16 items-center justify-between">
        <Link
          to="/dashboard"
          className="font-display text-[22px] font-medium tracking-tight text-ink"
          style={{ fontVariationSettings: '"opsz" 36' }}
        >
          Rehearsal
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-8">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "editorial-link is-quiet",
                  isActive ? "text-ink" : "text-ink-muted hover:text-ink",
                )
              }
            >
              <Eyebrow as="span">{link.label}</Eyebrow>
            </NavLink>
          ))}
          {user && (
            <button
              onClick={handleSignOut}
              className="editorial-link is-quiet text-ink-muted hover:text-ink"
            >
              <Eyebrow as="span">Sign out</Eyebrow>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
