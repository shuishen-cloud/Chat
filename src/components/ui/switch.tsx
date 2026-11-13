import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "cn"

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none",
        "bg-input data-[checked]:bg-primary",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-xs ring-0 transition-transform",
          "translate-x-0.5 data-[checked]:translate-x-4 dark:data-[checked]:bg-primary-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
