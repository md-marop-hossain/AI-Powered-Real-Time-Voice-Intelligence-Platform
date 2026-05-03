import { useLayoutEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import AccountPage from "@/pages/AccountPage";
import UploadPage from "@/pages/UploadPage";
import InterviewRoom from "@/pages/InterviewRoom";
import InterviewCompletePage from "@/pages/InterviewCompletePage";
import ReportPage from "@/pages/ReportPage";
import CreateInvitePage from "@/pages/CreateInvitePage";
import InviteLandingPage from "@/pages/InviteLandingPage";
import InvitesDashboardPage from "@/pages/InvitesDashboardPage";
import InviteResultsPage from "@/pages/InviteResultsPage";
import NotFoundPage from "@/pages/NotFoundPage";
import { ScrollToTop } from "@/components/editorial/ScrollToTop";
import { KeyboardShortcutsModal } from "@/components/editorial/KeyboardShortcutsModal";
import { easeEditorial } from "@/lib/motion";

export default function App() {
  const location = useLocation();
  const reduce = useReducedMotion();

  // Page transition: fade + small lift on every route change. Keying by
  // pathname (not the whole location) so query string changes don't retrigger.
  // The transition is short on purpose — slow page-level fades feel sluggish.
  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.28, ease: easeEditorial };

  // Reset scroll on every route change. Without this, navigating from a
  // long page (e.g. InterviewRoom with a tall conversation log) to a
  // short one (InterviewCompletePage) leaves window.scrollY parked at the
  // old page's bottom — the candidate sees a blank screen and has to
  // scroll up to find the new page. useLayoutEffect runs before paint, so
  // the user never sees the wrong scroll position.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    // `mode="wait"` was causing pages to mount stuck at opacity 0 when
    // navigate() fired during another transition (e.g. from inside a
    // setTimeout in ws.onclose). `mode="popLayout"` is the right balance:
    // exiting pages are popped out of layout (position: absolute) so they
    // don't contribute to document height — without it, the entering
    // page renders BELOW the still-mounted exiting page in document flow,
    // and the candidate ends up scrolled past the new content. With
    // popLayout the new page becomes the only thing affecting layout the
    // moment it mounts, so the scroll-reset above lands the user at the
    // top of the new page — not somewhere inside the old, fading one.
    <>
    <ScrollToTop />
    <KeyboardShortcutsModal />
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={transition}
        style={{ opacity: 1 }}
      >
        <Routes location={location}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/interview/:sessionId"
            element={
              <ProtectedRoute>
                <InterviewRoom />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions/:sessionId/complete"
            element={
              <ProtectedRoute>
                <InterviewCompletePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions/:sessionId/report"
            element={
              <ProtectedRoute>
                <ReportPage />
              </ProtectedRoute>
            }
          />

          {/* Invitations */}
          <Route path="/invite/:token" element={<InviteLandingPage />} />
          <Route
            path="/invite"
            element={
              <ProtectedRoute>
                <CreateInvitePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invites"
            element={
              <ProtectedRoute>
                <InvitesDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invites/:inviteId/results"
            element={
              <ProtectedRoute>
                <InviteResultsPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
    </>
  );
}
