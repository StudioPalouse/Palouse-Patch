import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppLayout } from "./components/layout.tsx";
import { ActivityPage } from "./pages/activity.tsx";
import { AiInventoryPage, AiRequestDetailPage, AiRequestFormPage, AiRequestsPage } from "./pages/ai.tsx";
import { ArtifactDetailPage, ArtifactFormPage, ArtifactsPage } from "./pages/artifacts.tsx";
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  OnboardingPage,
  ResetPasswordPage,
  SignInPage,
  SignUpPage,
} from "./pages/auth.tsx";
import { OverviewPage } from "./pages/overview.tsx";
import { PeoplePage, PersonDetailPage, PersonFormPage } from "./pages/people.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { SystemDetailPage, SystemFormPage, SystemsPage } from "./pages/systems.tsx";
import { TeamDetailPage, TeamFormPage, TeamsPage } from "./pages/teams.tsx";
import { UseCaseDetailPage, UseCaseFormPage, UseCasesPage } from "./pages/use-cases.tsx";

const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => <div className="p-12 text-center text-stone-500">Page not found</div>,
});

const signIn = createRoute({ getParentRoute: () => root, path: "/sign-in", component: SignInPage });
const signUp = createRoute({ getParentRoute: () => root, path: "/sign-up", component: SignUpPage });
const onboarding = createRoute({ getParentRoute: () => root, path: "/onboarding", component: OnboardingPage });
const forgotPassword = createRoute({ getParentRoute: () => root, path: "/forgot-password", component: ForgotPasswordPage });
const resetPassword = createRoute({ getParentRoute: () => root, path: "/reset-password", component: ResetPasswordPage });
const acceptInvitation = createRoute({
  getParentRoute: () => root,
  path: "/accept-invitation/$id",
  component: function AcceptInvitationRoute() {
    const { id } = acceptInvitation.useParams();
    return <AcceptInvitationPage id={id} />;
  },
});
const app = createRoute({ getParentRoute: () => root, id: "app", component: AppLayout });

const page = (path: string, component: () => React.ReactNode) => createRoute({ getParentRoute: () => app, path, component });

const routeTree = root.addChildren([
  signIn,
  signUp,
  onboarding,
  forgotPassword,
  resetPassword,
  acceptInvitation,
  app.addChildren([
    page("/", OverviewPage),
    page("/systems", SystemsPage),
    page("/systems/new", SystemFormPage),
    page("/systems/$id", SystemDetailPage),
    page("/systems/$id/edit", SystemFormPage),
    page("/use-cases", UseCasesPage),
    page("/use-cases/new", UseCaseFormPage),
    page("/use-cases/$id", UseCaseDetailPage),
    page("/use-cases/$id/edit", UseCaseFormPage),
    page("/artifacts", ArtifactsPage),
    page("/artifacts/new", ArtifactFormPage),
    page("/artifacts/$id", ArtifactDetailPage),
    page("/artifacts/$id/edit", ArtifactFormPage),
    page("/people", PeoplePage),
    page("/people/new", PersonFormPage),
    page("/people/$id", PersonDetailPage),
    page("/people/$id/edit", PersonFormPage),
    page("/teams", TeamsPage),
    page("/teams/new", TeamFormPage),
    page("/teams/$id", TeamDetailPage),
    page("/teams/$id/edit", TeamFormPage),
    page("/ai", AiInventoryPage),
    page("/ai/requests", AiRequestsPage),
    page("/ai/requests/new", AiRequestFormPage),
    page("/ai/requests/$id", AiRequestDetailPage),
    page("/ai/requests/$id/edit", AiRequestFormPage),
    page("/activity", ActivityPage),
    page("/settings", SettingsPage),
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });
