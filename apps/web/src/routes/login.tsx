import { loginRequest, setupRequest } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { Input } from "@hoardodile/ui/components/input"
import { toast } from "@hoardodile/ui/components/toast"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
	authStatusQueryKey,
	authStatusQueryOptions,
	HttpError,
	login,
	setup,
} from "@/features/auth"
import {
	hydrateSystemPrefs,
	invalidateSystemPrefsHydration,
} from "@/features/prefs/prefSyncHydrator"
import { isHoardodileDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/login")({
	beforeLoad: async ({ context }) => {
		try {
			const status = await context.queryClient.fetchQuery({
				...authStatusQueryOptions(),
				staleTime: 0,
			})
			if (status.authenticated) {
				throw redirect({ to: "/" })
			}
		} catch (err) {
			if (err instanceof HttpError) {
				return
			}
			throw err
		}
	},
	component: LoginRoute,
})

type LoginValues = { password: string }

/** `setupRequest` plus the client-side confirm field (checked on submit). */
const setupFormSchema = setupRequest.extend({ confirm: z.string() })

type SetupValues = z.infer<typeof setupFormSchema>

function LoginRoute() {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const { t } = useTranslation()
	const statusQuery = useQuery(authStatusQueryOptions())
	const unconfigured = statusQuery.data?.configured === false
	const demoLibrary = statusQuery.data?.demoPassword === true

	function heading(): string {
		if (unconfigured) return t("login.setupTitle")
		return t("login.title")
	}

	function description(): string {
		if (unconfigured) return t("login.setupDescription")
		if (demoLibrary) return t("login.demoDescription", { password: "demo" })
		return t("login.description")
	}

	const loginForm = useForm<LoginValues>({
		resolver: standardSchemaResolver(loginRequest),
		defaultValues: { password: "" },
		mode: "onSubmit",
	})

	useEffect(() => {
		if (!demoLibrary) return
		loginForm.reset({ password: "demo" })
	}, [demoLibrary, loginForm])

	const setupForm = useForm<SetupValues>({
		resolver: standardSchemaResolver(setupFormSchema),
		defaultValues: { password: "", confirm: "" },
		mode: "onSubmit",
	})

	const loginMutation = useMutation({
		mutationFn: login,
		onSuccess: async (status) => {
			queryClient.setQueryData(authStatusQueryKey, status)
			await queryClient.invalidateQueries({ queryKey: authStatusQueryKey })
			invalidateSystemPrefsHydration()
			await hydrateSystemPrefs()
			await navigate({ to: "/" })
		},
		onError: (err) => {
			if (err instanceof HttpError && err.status === 401) {
				if (err.message === "not configured") {
					// The password was cleared (e.g. CLI reset) while this
					// page was open; the status refetch flips the form back
					// into setup mode instead of reporting a wrong password.
					void queryClient.invalidateQueries({
						queryKey: authStatusQueryKey,
					})
					return
				}
				loginForm.setError("password", {
					type: "server",
					message: t("login.errorIncorrect"),
				})
				return
			}
			toast.add({ title: t("login.errorGeneric"), type: "error" })
		},
	})

	const setupMutation = useMutation({
		mutationFn: setup,
		onSuccess: (_result, variables) => loginMutation.mutate(variables),
		onError: (err) => {
			if (err instanceof HttpError && err.status === 409) {
				// Someone else claimed the instance while this page was open;
				// the status refetch flips the form back to sign-in mode.
				void queryClient.invalidateQueries({ queryKey: authStatusQueryKey })
				return
			}
			toast.add({ title: t("login.errorGeneric"), type: "error" })
		},
	})

	function handleSetupSubmit(values: SetupValues) {
		if (values.password !== values.confirm) {
			setupForm.setError("confirm", {
				type: "manual",
				message: t("login.setupMismatch"),
			})
			return
		}
		setupMutation.mutate({ password: values.password })
	}

	return (
		<div
			className={
				isHoardodileDesktop()
					? "flex h-full min-h-full items-center justify-center overflow-hidden bg-background p-6"
					: "flex min-h-svh items-center justify-center overflow-hidden bg-background p-6"
			}
		>
			<div className="flex w-full max-w-xs -translate-y-[5vh] flex-col items-center">
				<img
					src="/logo.png"
					alt=""
					width={56}
					height={56}
					className="size-14 object-cover"
				/>
				<span className="mt-4 text-xl font-semibold tracking-[0.18em] indent-[0.18em] text-foreground">
					{t("login.brand")}
				</span>
				<div aria-hidden="true" className="mt-4 flex items-center gap-2.5">
					<span className="h-px w-10 bg-border-strong" />
					<span className="size-1 rounded-full bg-muted-foreground" />
					<span className="h-px w-10 bg-border-strong" />
				</div>
				<div className="mt-8 flex flex-col items-center gap-2 text-center">
					<h1
						className="text-base font-medium text-foreground"
						data-testid="sign-in-heading"
					>
						{heading()}
					</h1>
					<p
						className={
							demoLibrary
								? "text-sm font-medium leading-relaxed text-foreground"
								: "text-[13px] leading-relaxed text-muted-foreground"
						}
						data-testid={demoLibrary ? "login-demo-hint" : undefined}
					>
						{description()}
					</p>
				</div>
				{unconfigured ? (
					<Form {...setupForm}>
						<form
							noValidate
							aria-label={t("login.setupFormAria")}
							onSubmit={setupForm.handleSubmit(handleSetupSubmit)}
							className="mt-8 flex w-full flex-col gap-4"
						>
							<FormField
								control={setupForm.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("login.setupPassword")}</FormLabel>
										<FormControl>
											<Input
												type="password"
												autoComplete="new-password"
												autoFocus
												size="lg"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={setupForm.control}
								name="confirm"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("login.setupConfirm")}</FormLabel>
										<FormControl>
											<Input
												type="password"
												autoComplete="new-password"
												size="lg"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<Button
								type="submit"
								disabled={setupMutation.isPending || loginMutation.isPending}
								data-testid="setup-submit"
								className="h-10 w-full rounded-lg bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
							>
								{setupMutation.isPending || loginMutation.isPending
									? t("login.setupSubmitting")
									: t("login.setupSubmit")}
							</Button>
						</form>
					</Form>
				) : (
					<Form {...loginForm}>
						<form
							noValidate
							aria-label={t("login.formAria")}
							onSubmit={loginForm.handleSubmit((values) =>
								loginMutation.mutate(values),
							)}
							className="mt-8 flex w-full flex-col gap-4"
						>
							<FormField
								control={loginForm.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("login.password")}</FormLabel>
										<FormControl>
											<Input
												type={demoLibrary ? "text" : "password"}
												autoComplete={demoLibrary ? "off" : "current-password"}
												autoFocus
												size="lg"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<Button
								type="submit"
								disabled={loginMutation.isPending}
								data-testid="login-submit"
								className="h-10 w-full rounded-lg bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
							>
								{loginMutation.isPending
									? t("login.submitting")
									: t("login.submit")}
							</Button>
						</form>
					</Form>
				)}
			</div>
		</div>
	)
}
