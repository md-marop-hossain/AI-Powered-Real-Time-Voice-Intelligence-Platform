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

  return (
    // `mode="wait"` was causing pages to mount stuck at opacity 0 when
    // navigate() fired during another transition (e.g. from inside a
    // setTimeout in ws.onclose). Default sync mode lets the new page
    // appear immediately while the old one fades — and crucially never
    // strands the new page in its initial state. We also guarantee the
    // page always animates *to* visible via `whileInView` style: even if
    // framer skips the enter animation, the element is opacity 1.
    <AnimatePresence initial={false}>
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
  );
}
