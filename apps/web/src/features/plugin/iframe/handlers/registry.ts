// Handler contract shared with the offline mock host — defined in
// @hoardodile/host-web so routing, validation and
// scoping never drift between the real host and the mock.
export {
	defineHandler,
	type HostHandlerContext,
	type HostHandlerEntry,
} from "@hoardodile/host-web"
