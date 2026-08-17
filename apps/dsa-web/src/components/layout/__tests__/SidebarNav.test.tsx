import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "../SidebarNav";

const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockGetScreeningStatus = vi
  .fn()
  .mockResolvedValue({ enabled: false, available: false });
const mockThemeToggle = vi.fn(({ collapsed }: { collapsed?: boolean }) => (
  <button type="button">{collapsed ? "切换主题(折叠)" : "切换主题"}</button>
));

const completionBadgeState = { value: true };

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    authEnabled: true,
    logout: mockLogout,
  }),
}));

vi.mock("../../../stores/agentChatStore", () => ({
  useAgentChatStore: (
    selector: (state: { completionBadge: boolean }) => unknown,
  ) => selector({ completionBadge: completionBadgeState.value }),
}));

vi.mock("../../../api/screening", () => ({
  SCREENING_CONFIG_CHANGED_EVENT: "screening-config-changed",
  SYSTEM_CONFIG_CHANGED_EVENT: "dsa-system-config-changed",
  screeningApi: {
    getStatus: () => mockGetScreeningStatus(),
  },
}));

vi.mock("../../theme/ThemeToggle", () => ({
  ThemeToggle: (props: { collapsed?: boolean }) => mockThemeToggle(props),
}));

describe("SidebarNav", () => {
  it("hides the screening navigation item while Screening is disabled", () => {
    mockGetScreeningStatus.mockResolvedValueOnce({
      enabled: false,
      available: true,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: "选股扫描" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "单股研究" })).toHaveAttribute(
      "href",
      "/stock-research",
    );
  });

  it("keeps ad-hoc stock research separate from strategy assets and validation", async () => {
    mockGetScreeningStatus.mockResolvedValueOnce({
      enabled: true,
      available: true,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "选股扫描" })).toHaveAttribute(
      "href",
      "/screening",
    );
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs.slice(0, 8)).toEqual([
      "/overview",
      "/strategies",
      "/backtests",
      "/runs",
      "/data",
      "/stock-research",
      "/screening",
      "/usage",
    ]);
    expect(screen.getByText("策略运营")).toBeInTheDocument();
    expect(screen.getByText("数据与应用")).toBeInTheDocument();
    expect(screen.getByText("治理与系统")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "执行与风险" })).not.toBeInTheDocument();
  });

  it("refreshes the controlled screening entry after config changes", async () => {
    mockGetScreeningStatus
      .mockResolvedValueOnce({ enabled: false, available: true })
      .mockResolvedValueOnce({ enabled: true, available: true });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: "选股扫描" }),
    ).not.toBeInTheDocument();
    window.dispatchEvent(new Event("screening-config-changed"));

    expect(await screen.findByRole("link", { name: "选股扫描" })).toHaveAttribute(
      "href",
      "/screening",
    );
    await waitFor(() =>
      expect(mockGetScreeningStatus.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("shows the shared completion badge only when chat completion is pending", () => {
    completionBadgeState.value = true;

    const { rerender } = render(
      <MemoryRouter initialEntries={["/chat"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("chat-completion-badge")).toBeInTheDocument();
    expect(screen.getByLabelText("问股有新消息")).toBeInTheDocument();

    completionBadgeState.value = false;
    rerender(
      <MemoryRouter initialEntries={["/chat"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("chat-completion-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders the collapsed theme toggle variant when the sidebar is collapsed", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarNav collapsed />
      </MemoryRouter>,
    );

    expect(mockThemeToggle).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "nav", collapsed: true }),
    );
    expect(
      screen.getByRole("button", { name: "切换主题(折叠)" }),
    ).toBeInTheDocument();
  });

  it("renders the run center navigation item and marks it active", () => {
    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    const runLink = screen.getByRole("link", { name: "运行中心" });
    expect(runLink).toHaveAttribute("href", "/runs");
    expect(runLink).toHaveClass("font-medium");
  });

  it("does not expose the legacy capability center in primary navigation", () => {
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "能力中心" })).not.toBeInTheDocument();
  });

  it("opens the logout confirmation and confirms logout", async () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <SidebarNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "退出" }));

    expect(
      await screen.findByRole("heading", { name: "退出登录" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认退出" }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
