import * as React from "react"

import { cn } from "@hoardodile/ui/lib/utils"
import { Button } from "@hoardodile/ui/components/button"
import { AltArrowLeft } from "@hoardodile/ui/icons/registry"
import { AltArrowRight } from "@hoardodile/ui/icons/registry"
import { MenuDots } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  const { t } = useTranslation("ui", { useSuspense: false })
  return (
    <nav
      role="navigation"
      aria-label={t("pagination.region")}
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <Button
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn(className)}
      nativeButton={false}
      render={
        <a
          aria-current={isActive ? "page" : undefined}
          data-slot="pagination-link"
          data-active={isActive}
          {...props}
        />
      }
    />
  )
}

function PaginationPrevious({
  className,
  text,
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  const { t } = useTranslation("ui", { useSuspense: false })
  return (
    <PaginationLink
      aria-label={t("pagination.previous")}
      size="default"
      className={cn("pl-2!", className)}
      {...props}
    >
      <AltArrowLeft data-icon="inline-start" />
      <span className="hidden sm:block">
        {text ?? t("pagination.previous")}
      </span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  text,
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  const { t } = useTranslation("ui", { useSuspense: false })
  return (
    <PaginationLink
      aria-label={t("pagination.next")}
      size="default"
      className={cn("pr-2!", className)}
      {...props}
    >
      <span className="hidden sm:block">{text ?? t("pagination.next")}</span>
      <AltArrowRight data-icon="inline-end" />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const { t } = useTranslation("ui", { useSuspense: false })
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-9 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <MenuDots
      />
      <span className="sr-only">{t("pagination.morePages")}</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
