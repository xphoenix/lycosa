module.exports = {
	toBeInRange: function(left, right) {
		if (this.actual === undefined) {
			throw new Error("actual is not defined");
		}

		if (this.actual === null) {
			throw new Error("actual is null");
		}

		return  left <= this.actual && this.actual <= right;
	}
};