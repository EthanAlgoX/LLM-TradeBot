import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StrategyLifecycleNav } from "../StrategyLifecycleNav";

describe("StrategyLifecycleNav", () => {
  it("shows the strategy, validation, and run lifecycle with data as a dependency", () => {
    render(
      <MemoryRouter>
        <StrategyLifecycleNav current="backtests" />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "策略工作链",
    });
    const links = within(navigation).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/strategies",
      "/backtests",
      "/runs",
      "/data",
    ]);
    expect(
      within(navigation).getByRole("link", { name: /验证中心/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByText(/数据依赖由数据中心提供/)).toBeInTheDocument();
  });
});
