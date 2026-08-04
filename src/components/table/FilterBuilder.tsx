"use client";

import { ListFilter, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	FILTER_FIELD_IDS,
	FILTER_FIELDS,
	FILTER_OPS,
	type FilterFieldId,
	type FilterOp,
	//formatFilterValue,
	fromDisplayValue,
	OPERATORS,
	type TableFilter,
	toDisplayValue,
} from "@/lib/table-filters";

/**
 * The numeric input for one filter row's value.
 *
 * Deriving `value` straight from `toDisplayValue(f.value)` on every render
 * cannot represent "the user just cleared the field": `Number('')` is `0`
 * and `Number.isFinite(0)` is `true`, so an empty box would either snap back
 * to `0` or, if the empty case were special-cased in the parent without
 * local state, could be re-clobbered by an unrelated parent re-render before
 * the user finishes retyping. Local state for the raw text is what lets the
 * box stay visually empty until a real number replaces it, without ever
 * writing a fake `0` into the filter itself.
 */
function FilterValueInput({
	field,
	value,
	onChange,
}: {
	field: FilterFieldId;
	value: number;
	onChange: (next: number) => void;
}) {
	const [raw, setRaw] = useState(() => String(toDisplayValue(field, value)));

	// Re-sync when the canonical value changes from outside this input — the
	// field switched, the row reset, or another control wrote a new value.
	useEffect(() => {
		setRaw(String(toDisplayValue(field, value)));
	}, [field, value]);

	return (
		<Input
			type="number"
			inputMode="decimal"
			aria-label={`${FILTER_FIELDS[field].label} value`}
			className="h-8 pr-7 text-xs"
			value={raw}
			onChange={(e) => {
				const text = e.target.value;
				setRaw(text);
				// Leave the stored filter value untouched while the box is empty —
				// do not coerce it to 0. The user is mid-edit, not asserting zero.
				if (text === "") return;
				const typed = Number(text);
				if (!Number.isFinite(typed)) return;
				onChange(fromDisplayValue(field, typed));
			}}
		/>
	);
}

/**
 * The display filters, as rows the user can read and move.
 *
 * The fields are named after the TABLE'S COLUMNS — Deposits, Liquidity, Net
 * APY, Utilization — not after SQL columns. That is also what settles the
 * borrow table's real ambiguity: it shows both Deposits and Liquidity, and a
 * filter has to say which one it judges. It says it by carrying its name.
 *
 * Operators are numeric only. `like` / `ilike` / `in` mean nothing on a TVL and
 * are not offered.
 *
 * The chips outside the popover are not decoration: filters are persisted, so
 * without a permanently visible state someone would read a table days later in
 * a regime they no longer remember choosing.
 */
export function FilterBuilder({
	filters,
	onChange,
	onClear,
	onReset,
}: {
	filters: TableFilter[];
	onChange: (next: TableFilter[]) => void;
	onClear: () => void;
	onReset: () => void;
}) {
	const [open, setOpen] = useState(false);

	const patch = (index: number, next: Partial<TableFilter>) =>
		onChange(filters.map((f, i) => (i === index ? { ...f, ...next } : f)));

	const remove = (index: number) =>
		onChange(filters.filter((_, i) => i !== index));

	const add = () => {
		const unused = FILTER_FIELD_IDS.find(
			(id) => !filters.some((f) => f.field === id),
		);
		onChange([
			...filters,
			{ id: crypto.randomUUID(), field: unused ?? FILTER_FIELD_IDS[0], op: "gte", value: 0 },
		]);
	};

	return (
		<>
			{/* {filters.map((f, i) => (
        <Badge
          key={`${f.field}-${f.op}-${i}`}
          variant="secondary"
          className="h-9 gap-1 rounded-md px-2 text-xs font-normal"
        >
          <span className="text-muted-foreground">
            {FILTER_FIELDS[f.field].label}
          </span>
          <span>{OPERATORS[f.op].label}</span>
          <span className="font-mono">
            {formatFilterValue(f.field, f.value)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${FILTER_FIELDS[f.field].label} filter`}
            className="hover:text-foreground text-muted-foreground ml-0.5 cursor-pointer"
            onClick={() => remove(i)}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))} */}

			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="h-9 gap-1.5 border text-xs"
					>
						<ListFilter className="text-muted-foreground h-3.5 w-3.5" />
						Filters
						{filters.length > 0 && (
							<Badge variant="secondary" className="text-2xs rounded-sm px-1">
								{filters.length}
							</Badge>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-104 p-3" align="end">
					<div className="flex flex-col gap-2">
						{filters.length === 0 && (
							<p className="text-muted-foreground py-2 text-xs">
								No filters — every market in the catalogue is shown.
							</p>
						)}

						{filters.map((f, i) => (
							<div key={`row-${f.id}`} className="flex items-center gap-1.5">
								<span className="text-muted-foreground w-10 shrink-0 text-xs">
									{i === 0 ? "where" : "and"}
								</span>

								<Select
									value={f.field}
									onValueChange={(v) => patch(i, { field: v as FilterFieldId })}
								>
									<SelectTrigger size="sm" className="h-8 w-32 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{FILTER_FIELD_IDS.map((id) => (
											<SelectItem key={id} value={id} className="text-xs">
												{FILTER_FIELDS[id].label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Select
									value={f.op}
									onValueChange={(v) => patch(i, { op: v as FilterOp })}
								>
									<SelectTrigger size="sm" className="h-8 w-16 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{FILTER_OPS.map((op) => (
											<SelectItem key={op} value={op} className="text-xs">
												{OPERATORS[op].label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<div className="relative flex-1">
									<FilterValueInput
										field={f.field}
										value={f.value}
										onChange={(next) => patch(i, { value: next })}
									/>
									<span className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-xs">
										{FILTER_FIELDS[f.field].unit === "usd" ? "$" : "%"}
									</span>
								</div>

								<button
									type="button"
									aria-label="Remove filter"
									className="hover:text-foreground text-muted-foreground cursor-pointer"
									onClick={() => remove(i)}
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</div>
						))}

						<div className="border-border/50 mt-1 flex items-center justify-between border-t pt-2">
							<Button
								variant="ghost"
								size="sm"
								className="h-7 cursor-pointer px-2 text-xs"
								onClick={add}
							>
								<Plus className="h-3.5 w-3.5" />
								Add filter
							</Button>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									className="text-muted-foreground h-7 cursor-pointer px-2 text-xs"
									onClick={onReset}
								>
									Reset to defaults
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 cursor-pointer px-2 text-xs"
									onClick={onClear}
									disabled={filters.length === 0}
								>
									Clear filters
								</Button>
							</div>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}
