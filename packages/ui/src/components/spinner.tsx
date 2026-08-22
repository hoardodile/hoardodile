import { cn } from "@hoardodile/ui/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
	return (
		<svg
			data-slot="spinner"
			role="status"
			aria-label="Loading"
			viewBox="0 0 24 24"
			fill="none"
			className={cn("size-4 animate-spin", className)}
			{...props}
		>
			<circle
				className="opacity-25"
				cx="12"
				cy="12"
				r="10"
				stroke="currentColor"
				strokeWidth="4"
			/>
			<path
				d="M22 12a10 10 0 0 0-10-10"
				stroke="currentColor"
				strokeWidth="4"
				strokeLinecap="round"
			/>
		</svg>
	)
}

export { Spinner }
